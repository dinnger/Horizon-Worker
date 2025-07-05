import type { IWorkflowExecutionContextInterface } from '@shared/interfaces/workflow.execute.interface.js'
import type { IWorkflow } from '@shared/interfaces/workflow.interface.js'
import { v4 as uuidv4 } from 'uuid'
import { Worker } from './worker.js'
import { getArgs } from './shared/functions/utils.js'
import { TransferListItem, workerData } from 'node:worker_threads'
import { setSecret } from '../shared/store/secret.store.js'
import express, { type Express } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import http from 'node:http'
import envs from '../shared/utils/envs.js'
import cluster from 'node:cluster'
import os from 'node:os'
import fs from 'node:fs'
import bodyParser from 'body-parser'
import fileUpload from 'express-fileupload'
import { parentPort, sendData, setParentPort } from './shared/functions/parentPort.js'
import { initServerComm, getNodesFromServer } from './shared/functions/serverComm.js'

// Worker communication with server
interface ServerRequest {
	route: string
	data: any
}

interface ServerResponse {
	success: boolean
	data?: any
	message?: string
}

class WorkerServerComm {
	private workerId: string
	private serverPort: string
	private pendingRequests: Map<
		string,
		{
			resolve: (value: any) => void
			reject: (error: Error) => void
		}
	> = new Map()

	constructor(workerId: string, serverPort: string) {
		this.workerId = workerId
		this.serverPort = serverPort
		this.setupMessageHandling()
	}

	private setupMessageHandling() {
		// Handle responses from parent process
		process.on('message', (message: any) => {
			if (message.type === 'response' && message.requestId) {
				const pending = this.pendingRequests.get(message.requestId)
				if (pending) {
					if (message.success) {
						pending.resolve(message.data)
					} else {
						pending.reject(new Error(message.message || 'Request failed'))
					}
					this.pendingRequests.delete(message.requestId)
				}
			}
		})
	}

	async requestFromServer(route: string, data: any = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const requestId = uuidv4()
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(requestId)
				reject(new Error('Request timeout'))
			}, 30000)

			this.pendingRequests.set(requestId, {
				resolve: (value) => {
					clearTimeout(timeout)
					resolve(value)
				},
				reject: (error) => {
					clearTimeout(timeout)
					reject(error)
				}
			})

			// Send request to parent process which will forward to server
			if (process.send) {
				process.send({
					type: 'request',
					route,
					data,
					requestId,
					workerId: this.workerId
				})
			} else {
				this.pendingRequests.delete(requestId)
				reject(new Error('No parent process available'))
			}
		})
	}

	async sendStats(stats: any) {
		if (process.send) {
			process.send({
				type: 'stats',
				data: stats,
				workerId: this.workerId
			})
		}
	}

	async sendReady() {
		if (process.send) {
			process.send({
				type: 'ready',
				workerId: this.workerId
			})
		}
	}

	async sendError(error: string) {
		if (process.send) {
			process.send({
				type: 'error',
				data: { message: error },
				workerId: this.workerId
			})
		}
	}
}

let PATH_FLOW = './data/workflows/'
const { FLOW, PORT } = workerData || getArgs()
const WORKER_ID = process.env.WORKER_ID || uuidv4()
const SERVER_PORT = process.env.SERVER_PORT || '3000'
const IS_DEV = envs.NODE_ENV === 'development'
const SERVER_CLUSTER = envs.SERVER_CLUSTERS

// Initialize worker-server communication
const serverComm = new WorkerServerComm(WORKER_ID, SERVER_PORT)

let numCPUs = SERVER_CLUSTER < os.cpus().length ? SERVER_CLUSTER : os.cpus().length
if (numCPUs < 1) numCPUs = 1

const workerStart = async ({
	primary = true,
	uidFlow = FLOW,
	tempPort = PORT || envs.SERVER_PORT,
	index = 0
}: {
	primary?: boolean
	uidFlow?: string
	tempPort?: number
	index?: number
} = {}) => {
	// Sanitize flow
	if (uidFlow?.indexOf('/') > -1) {
		PATH_FLOW = ''
	}

	// ============================================================================
	// Worker
	// ============================================================================
	async function initWorker({ app }: { app: Express }) {
		try {
			console.log(`Inicializando worker ${WORKER_ID} para workflow ${uidFlow}`)

			// Initialize server communication helper
			initServerComm(serverComm)

			// Send ready signal to server
			await serverComm.sendReady()

			// Request nodes list from server to test communication
			try {
				const nodesList = await getNodesFromServer()
				console.log(`Worker ${WORKER_ID}: Recibida lista de nodos (${Object.keys(nodesList).length} nodos)`)
			} catch (error) {
				console.warn(`Worker ${WORKER_ID}: Error obteniendo lista de nodos:`, error)
			}

			// const dataProject = fs.readFileSync(
			// 	`${PATH_FLOW}${uidFlow}/project.config.json`,
			// 	'utf8'
			// )
			const data = fs.readFileSync(`${PATH_FLOW}${uidFlow}/flow.json`, 'utf8')
			if (!data) {
				await serverComm.sendError('No se pudo leer el archivo flow.json')
				return
			}

			// const project = JSON.parse(dataProject || '{}')
			const flow: IWorkflow = JSON.parse(data)
			const context: IWorkflowExecutionContextInterface = {
				info: flow.info,
				properties: flow.properties,
				secrets: flow.secrets,
				currentNode: null
			}

			const worker = new Worker({
				app,
				context,
				uidFlow,
				isDev: IS_DEV,
				index
			})

			// Extend worker with server communication
			// worker.serverComm = serverComm

			// Project
			worker.virtualModule.virtualProject(flow.project)
			// Properties
			worker.virtualModule.virtualPropertiesWatch(flow.properties, true)
			// Nodes
			for (const key of Object.keys(flow.nodes)) {
				const node = flow.nodes[key]
				const newNode = worker.nodeModule.addNode({
					id: key,
					name: node.name,
					pos: { x: node.x, y: node.y },
					className: node.type,
					properties: node.properties || {},
					meta: node.meta
				})
			}
			for (const key of Object.keys(flow.connections)) {
				const connection = flow.connections[key as any]
				worker.nodeModule.addEdge({
					id: connection.id,
					id_node_origin: connection.id_node_origin,
					id_node_destiny: connection.id_node_destiny,
					output: connection.output,
					input: connection.input
				})
			}

			// =========================================================================
			// ENVS
			// =========================================================================
			if (IS_DEV) {
				await worker.variableModule.initVariable({ uidFlow })
			}
			await worker.variableModule.checkWorkflowEnvironment({ flow })
			// =========================================================================

			// Send periodic stats to server
			const statsInterval = setInterval(async () => {
				try {
					const memUsage = process.memoryUsage()
					const cpuUsage = process.cpuUsage()

					await serverComm.sendStats({
						memoryUsage: {
							rss: memUsage.rss,
							heapUsed: memUsage.heapUsed,
							heapTotal: memUsage.heapTotal,
							external: memUsage.external
						},
						cpuUsage: {
							user: cpuUsage.user,
							system: cpuUsage.system
						}
					})
				} catch (error) {
					console.warn('Error enviando estadísticas:', error)
				}
			}, 10000) // Every 10 seconds

			// Cleanup on process exit
			process.on('exit', () => {
				clearInterval(statsInterval)
			})

			process.on('SIGTERM', () => {
				clearInterval(statsInterval)
				console.log(`Worker ${WORKER_ID} recibió SIGTERM, terminando...`)
				process.exit(0)
			})

			process.on('SIGINT', () => {
				clearInterval(statsInterval)
				console.log(`Worker ${WORKER_ID} recibió SIGINT, terminando...`)
				process.exit(0)
			})

			// Handle shutdown message from parent
			process.on('message', (message: any) => {
				if (message.type === 'shutdown') {
					clearInterval(statsInterval)
					console.log(`Worker ${WORKER_ID} recibió mensaje de shutdown, terminando...`)
					process.exit(0)
				}
			})

			worker.coreModule.startExecution({
				inputData: { idNode: '', inputName: '', data: {} },
				executeData: new Map(),
				executeMeta: { accumulativeTime: 0 }
			})
		} catch (error) {
			console.error(`Error inicializando worker ${WORKER_ID}:`, error)
			await serverComm.sendError(error instanceof Error ? error.message : 'Error desconocido')
			process.exit(1)
		}
	}
	// ============================================================================

	const app = express()

	app.set('trust proxy', 1) // trust first proxy
	app.use(helmet())
	app.use(cors())
	app.use(bodyParser.urlencoded({ extended: true }))
	app.use(bodyParser.json())
	app.use(
		fileUpload({
			limits: { fileSize: 50 * 1024 * 1024 }
		})
	)

	const server = http.createServer(app)

	server.listen(tempPort, async () => {
		console.log(`[port: ${tempPort}, flow: ${uidFlow}, isDev: ${IS_DEV}]`)
		// Indica que el worker se ha iniciado correctamente
		if (IS_DEV) {
			parentPort?.postMessage({ type: 'init', value: 'worker init' })
		}

		await initWorker({ app })
	})
}

if (numCPUs === 1) {
	workerStart()
} else {
	if (cluster.isPrimary) {
		console.log({ FLOW, PORT, CLUSTERS: numCPUs, IS_DEV })

		cluster.setupPrimary({
			serialization: 'advanced'
		})

		process.argv.push(`--FLOW=${FLOW}`)
		process.argv.push(`--PORT=${PORT}`)

		for (let i = 0; i < numCPUs; i++) {
			const worker = cluster.fork()
			worker.on('message', async (msg) => {
				if (msg && msg.type === 'WORKER_READY') {
					worker.send({
						type: 'WORKER_READY',
						data: { FLOW, PORT, INDEX: i + 1 }
					})
				} else {
					// Enviando datos al worker
					const resp = await sendData(msg.type, msg.data)
					worker.send({ type: 'RESPONSE', data: resp, uid: msg.uid })
				}
			})
		}

		cluster.on('exit', (worker, code, signal) => {
			console.log(`Worker process ${worker.process.pid} died. Restarting...`)
			cluster.fork()
		})

		if (IS_DEV) {
			parentPort?.postMessage({ type: 'init', value: 'worker init' })
		}
	} else {
		if (process.send) {
			process.send({
				type: 'WORKER_READY',
				pid: process.pid
			})
		}

		const listProcess: Map<string, any> = new Map()
		process.on('message', (msg: any) => {
			if (msg && msg.type === 'WORKER_READY') {
				setParentPort({
					postMessage: (data: any, ports?: MessagePort[]) => {
						if (ports && ports.length > 0) {
							const uid = uuidv4()
							if (process.send) {
								listProcess.set(uid, ports[0])
								process.send({
									type: data.type,
									data: data.data,
									uid
								})
							}
						}
					}
				})
				const { FLOW, PORT, INDEX } = msg.data
				workerStart({ uidFlow: FLOW, tempPort: PORT, index: INDEX })
			} else if (msg && msg.type === 'RESPONSE') {
				listProcess.get(msg.uid)?.postMessage(msg.data)
			}
		})
	}
}
