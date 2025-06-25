import { VariableModule } from './modules/variables/index.js'
import type { IWorkflowExecutionContextInterface } from '@shared/interfaces/workflow.execute.interface.js'
import type { classBaseEnvironmentInterface } from '../shared/interfaces/class.interface.js'
import { NodeModule } from './modules/workflow/index.js'
import { CoreModule } from './modules/core/index.js'
import type { Express } from 'express'
import envs from '../shared/utils/envs.js'
import { VirtualModule } from './modules/virtual/index.js'
import { CommunicationModule } from './modules/communication/index.js'
// -----------------------------------------------------------------------------
// Base
// -----------------------------------------------------------------------------

export const info = {}
export class Worker {
	app: Express
	flow: string
	context: IWorkflowExecutionContextInterface
	environment: classBaseEnvironmentInterface

	index: number | null
	isDev: boolean

	coreModule: CoreModule
	nodeModule: NodeModule
	communicationModule: CommunicationModule
	virtualModule: VirtualModule
	variableModule: VariableModule

	constructor({
		app,
		context,
		uidFlow,
		isDev,
		index
	}: {
		app: Express
		context: IWorkflowExecutionContextInterface
		uidFlow: string
		isDev: boolean
		index: number
	}) {
		this.flow = uidFlow
		this.app = app
		this.context = context
		this.isDev = isDev
		this.index = index

		this.environment = {
			baseUrl: this.context.properties?.basic?.router || '',
			serverUrl: envs.SERVER_URL,
			isDev,
			isSubFlow: false,
			subFlowBase: '',
			subFlowParent: ''
		}

		this.communicationModule = new CommunicationModule({ el: this })
		this.variableModule = new VariableModule({ el: this })
		this.virtualModule = new VirtualModule({ el: this })
		this.coreModule = new CoreModule({ el: this })
		this.nodeModule = new NodeModule({ el: this })
	}
}
