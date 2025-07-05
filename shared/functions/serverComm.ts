/**
 * Worker Server Communication Helper
 *
 * Provides helper functions for workers to communicate with the main server
 * and request data like nodes, workflows, etc.
 */

// Global server communication instance
let serverComm: any = null

/**
 * Initialize server communication for the worker
 */
export function initServerComm(commInstance: any) {
	serverComm = commInstance
}

/**
 * Request nodes list from server
 */
export async function getNodesFromServer(): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('nodes:list')
	} catch (error) {
		console.error('Error getting nodes from server:', error)
		throw error
	}
}

/**
 * Request specific node information from server
 */
export async function getNodeFromServer(nodeType: string): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('nodes:get', { type: nodeType })
	} catch (error) {
		console.error(`Error getting node ${nodeType} from server:`, error)
		throw error
	}
}

/**
 * Request workflow information from server
 */
export async function getWorkflowFromServer(workflowId: string): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('workflows:get', { id: workflowId })
	} catch (error) {
		console.error(`Error getting workflow ${workflowId} from server:`, error)
		throw error
	}
}

/**
 * Request system health information from server
 */
export async function getSystemHealthFromServer(): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('system:health')
	} catch (error) {
		console.error('Error getting system health from server:', error)
		throw error
	}
}

/**
 * Send worker logs to server (for centralized logging)
 */
export async function sendWorkerLog(level: 'info' | 'warn' | 'error', message: string, data?: any): Promise<void> {
	if (!serverComm) {
		console.warn('Server communication not initialized, logging locally only')
		return
	}

	try {
		await serverComm.requestFromServer('worker:log', {
			level,
			message,
			data,
			timestamp: new Date().toISOString()
		})
	} catch (error) {
		console.warn('Failed to send log to server:', error)
	}
}

/**
 * Report worker progress to server
 */
export async function reportProgress(progress: {
	nodeId?: string
	stepName?: string
	percentage?: number
	message?: string
	data?: any
}): Promise<void> {
	if (!serverComm) {
		return
	}

	try {
		await serverComm.requestFromServer('worker:progress', {
			...progress,
			timestamp: new Date().toISOString()
		})
	} catch (error) {
		console.warn('Failed to report progress to server:', error)
	}
}

/**
 * Request database connection info or perform database operations through server
 */
export async function requestDatabaseOperation(operation: string, params: any): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('database:operation', {
			operation,
			params
		})
	} catch (error) {
		console.error(`Error performing database operation ${operation}:`, error)
		throw error
	}
}

/**
 * Request external API call through server (for rate limiting, auth, etc.)
 */
export async function requestExternalAPI(config: {
	url: string
	method?: string
	headers?: Record<string, string>
	data?: any
	timeout?: number
}): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('external:api', config)
	} catch (error) {
		console.error('Error making external API request through server:', error)
		throw error
	}
}

/**
 * Request file operations through server
 */
export async function requestFileOperation(
	operation: 'read' | 'write' | 'delete' | 'list',
	params: {
		path: string
		data?: any
		encoding?: string
	}
): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('file:operation', {
			operation,
			...params
		})
	} catch (error) {
		console.error(`Error performing file operation ${operation}:`, error)
		throw error
	}
}

/**
 * Send worker metrics to server for monitoring
 */
export async function sendMetrics(metrics: {
	executionTime?: number
	memoryUsage?: any
	cpuUsage?: any
	nodesProcessed?: number
	errorsCount?: number
	customMetrics?: Record<string, any>
}): Promise<void> {
	if (!serverComm) {
		return
	}

	try {
		await serverComm.requestFromServer('worker:metrics', {
			...metrics,
			timestamp: new Date().toISOString()
		})
	} catch (error) {
		console.warn('Failed to send metrics to server:', error)
	}
}

/**
 * Request credentials from server (secure credential management)
 */
export async function getCredentialsFromServer(credentialId: string): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('credentials:get', { id: credentialId })
	} catch (error) {
		console.error(`Error getting credentials ${credentialId} from server:`, error)
		throw error
	}
}

/**
 * Request environment variables from server
 */
export async function getEnvironmentFromServer(key?: string): Promise<any> {
	if (!serverComm) {
		throw new Error('Server communication not initialized')
	}

	try {
		return await serverComm.requestFromServer('environment:get', { key })
	} catch (error) {
		console.error('Error getting environment from server:', error)
		throw error
	}
}
