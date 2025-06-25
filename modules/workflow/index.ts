import type { IPropertiesType } from '@shared/interfaces/workflow.properties.interface.js'
import type { Worker } from '../../worker.js'
import type { IMetaNode, INodeClass } from '@shared/interfaces/workflow.interface.js'
import { getNodeClass } from '../../../shared/store/node.store.js'
import { v4 as uuidv4 } from 'uuid'

interface IDependencies {
	secrets: Set<{
		idNode: string
		type: string
		name: string
		secret: string
	}>
	credentials: Set<{
		idNode: string
		type: string
		name: string
		credentials: string[]
	}>
}

export class NodeModule {
	el: Worker

	nodesInit: INodeClass | null = null
	nodes: { [key: string]: INodeClass } = {}
	nodesType = new Map<string, Set<string>>()
	nodesClass = getNodeClass()
	connections: {
		[key: string]: {
			[key: string]: { id_node_destiny: string; input: string }[]
		}
	} = {}
	connectionsInputs: { [key: string]: Set<string> } = {}
	connectionsOutputs: { [key: string]: Set<string> } = {}

	dependencies: IDependencies = {
		secrets: new Set(),
		credentials: new Set()
	}

	constructor({ el }: { el: Worker }) {
		this.el = el
	}

	/**
	 * Adds a new node to the system.
	 *
	 * @param {Object} params - The parameters for adding a node.
	 * @param {string} [params.id] - The unique identifier for the node. If not provided, a new UUID will be generated.
	 * @param {string} params.name - The name of the node.
	 * @param {string} params.className - The class name of the node.
	 * @param {Object} params.pos - The position of the node.
	 * @param {number} params.pos.x - The x-coordinate of the node's position.
	 * @param {number} params.pos.y - The y-coordinate of the node's position.
	 * @param {IPropertiesType} [params.properties={}] - The properties of the node.
	 * @param {Object} [params.meta] - Additional metadata for the node.
	 * @returns {INode} The newly added node.
	 * @throws {Error} If the class name does not exist in nodesClass.
	 */
	addNode({
		id,
		name,
		className,
		pos,
		properties = {},
		meta
	}: {
		id?: string
		name: string
		className: string
		pos: { x: number; y: number }
		properties?: IPropertiesType
		meta?: IMetaNode
	}): INodeClass | null {
		if (!this.el) return null
		if (!this.nodesClass[className]) {
			console.error(`No existe el nodo ${className}`)
		}
		id = id || uuidv4()

		const prop: { [key: string]: any } = {}
		if (this.nodesClass[className]?.properties) {
			for (const [key, value] of Object.entries(this.nodesClass[className].properties) as [string, any][]) {
				prop[key] = JSON.parse(JSON.stringify(value))
				if (value.onTransform) prop[key].onTransform = value.onTransform
				if (value.type === 'list') {
					prop[key].object = value.object
				}
				if (properties[key]?.value) {
					prop[key].value = properties[key].value
				}
			}
		}

		// Determinando si la propiedad secret o credencial
		for (const [key, value] of Object.entries(prop)) {
			if (!value.value || value?.value.toString().trim() === '') continue

			// Secrets
			if (value.type === 'secret') {
				this.dependencies.secrets.add({
					idNode: id,
					name: value.value,
					type: className,
					secret: value.value
				})
			}
			// Credentials
			if (value.type === 'credential') {
				this.dependencies.credentials.add({
					idNode: id,
					type: className,
					name: value.value,
					credentials: meta?.credentials || []
				})
			}
		}

		this.nodes[id] = {
			id,
			name,
			properties: prop,
			meta,
			x: pos.x,
			y: pos.y,
			type: className,
			class: this.nodesClass[className]?.class
		}

		if (!this.nodesType.has(className)) {
			this.nodesType.set(className, new Set())
		}
		this.nodesType.get(className)?.add(id)
		if (this.nodes[id].type === 'workflow_init') this.nodesInit = this.nodes[id]

		// Iniciar propiedades virtuales para manipulación de datos
		if (this.el.isDev) {
			this.el.virtualModule.virtualNodeAdd({ node: this.nodes[id] })
		}

		return this.nodes[id]
	}

	/**
	 * Adds an edge to the connections object, linking an origin node's output to a destination node's input.
	 *
	 * @param {Object} params - The parameters for adding an edge.
	 * @param {string} params.id_node_origin - The ID of the origin node.
	 * @param {string} params.output - The output of the origin node.
	 * @param {string} params.id_node_destiny - The ID of the destination node.
	 * @param {string} params.input - The input of the destination node.
	 */
	addEdge({
		id,
		id_node_origin,
		output,
		id_node_destiny,
		input
	}: {
		id: string
		id_node_origin: string
		output: string
		id_node_destiny: string
		input: string
	}) {
		if (!this.el) return
		if (!this.connections[id_node_origin]) this.connections[id_node_origin] = {}
		if (!this.connections[id_node_origin][output]) this.connections[id_node_origin][output] = []
		this.connections[id_node_origin][output].push({ id_node_destiny, input })

		// Guardar los nodos que se conectan a un nodo
		if (!this.connectionsInputs[id_node_destiny]) this.connectionsInputs[id_node_destiny] = new Set()
		if (!this.connectionsOutputs[id_node_origin]) this.connectionsOutputs[id_node_origin] = new Set()
		this.connectionsInputs[id_node_destiny].add(id_node_origin)
		this.connectionsOutputs[id_node_origin].add(id_node_destiny)
		// Iniciar propiedades virtuales para manipulación de datos
		if (this.el.isDev) {
			this.el.virtualModule.virtualConnectionAdd({
				id,
				id_node_origin,
				output,
				id_node_destiny,
				input
			})
		}
	}
}
