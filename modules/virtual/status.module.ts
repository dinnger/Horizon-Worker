// Validación de estado de workflow
let isChange = false

export const getStatusChange = () => {
	const status = isChange
	isChange = false
	return status
}

export const updateChangeStatus = (value: boolean) => {
	isChange = value
}
