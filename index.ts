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
import {
	parentPort,
	sendData,
	setParentPort
} from './shared/functions/parentPort.js'

let PATH_FLOW = './data/workflows/'
const { FLOW, PORT } = workerData || getArgs()
const IS_DEV = envs.NODE_ENV === 'development'
const SERVER_CLUSTER = envs.SERVER_CLUSTERS

let numCPUs =
	SERVER_CLUSTER < os.cpus().length ? SERVER_CLUSTER : os.cpus().length
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
		// const dataProject = fs.readFileSync(
		// 	`${PATH_FLOW}${uidFlow}/project.config.json`,
		// 	'utf8'
		// )
		const data = fs.readFileSync(`${PATH_FLOW}${uidFlow}/flow.json`, 'utf8')
		if (!data) return

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

		worker.coreModule.startExecution({
			inputData: { idNode: '', inputName: '', data: {} },
			executeData: new Map(),
			executeMeta: { accumulativeTime: 0 }
		})
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
