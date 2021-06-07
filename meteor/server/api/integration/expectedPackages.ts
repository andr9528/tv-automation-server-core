import { check } from '../../../lib/check'
import { Meteor } from 'meteor/meteor'
import { PeripheralDeviceId } from '../../../lib/collections/PeripheralDevices'
import { MethodContext } from '../../../lib/api/methods'
import { checkAccessAndGetPeripheralDevice } from '../ingest/lib'
import { ExpectedPackageId, ExpectedPackages } from '../../../lib/collections/ExpectedPackages'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import {
	ExpectedPackageWorkStatus,
	ExpectedPackageWorkStatuses,
	ExpectedPackageWorkStatusId,
} from '../../../lib/collections/ExpectedPackageWorkStatuses'
import { assertNever, getCurrentTime, literal, waitForPromise, waitForPromiseAll } from '../../../lib/lib'
import {
	getPackageContainerPackageId,
	PackageContainerPackageStatuses,
	PackageContainerPackageStatusDB,
	PackageContainerPackageId,
} from '../../../lib/collections/PackageContainerPackageStatus'
import {
	getPackageInfoId,
	PackageInfoBase,
	PackageInfoDB,
	PackageInfoDBType,
	PackageInfos,
} from '../../../lib/collections/PackageInfos'
import { BulkWriteOperation } from 'mongodb'
import { asyncCollectionBulkWrite, asyncCollectionFindOne, asyncCollectionRemove } from '../../lib/database'

export namespace PackageManagerIntegration {
	export function updateExpectedPackageWorkStatuses(
		context: MethodContext,
		deviceId: PeripheralDeviceId,
		deviceToken: string,
		changes: (
			| {
					id: ExpectedPackageWorkStatusId
					type: 'delete'
			  }
			| {
					id: ExpectedPackageWorkStatusId
					type: 'insert'
					status: ExpectedPackageStatusAPI.WorkStatus
			  }
			| {
					id: ExpectedPackageWorkStatusId
					type: 'update'
					status: Partial<ExpectedPackageStatusAPI.WorkStatus>
			  }
		)[]
	): void {
		type FromPackage = Omit<ExpectedPackageStatusAPI.WorkBaseInfoFromPackage, 'id'> & { id: ExpectedPackageId }

		const peripheralDevice = checkAccessAndGetPeripheralDevice(deviceId, deviceToken, context)
		if (!peripheralDevice.studioId)
			throw new Meteor.Error(400, 'Device "' + peripheralDevice._id + '" has no studio')

		const bulkChanges: BulkWriteOperation<ExpectedPackageWorkStatus>[] = []
		const removedIds: ExpectedPackageWorkStatusId[] = []

		const ps: Promise<void>[] = []
		for (const change of changes) {
			check(change.id, String)
			check(change, Object)

			if (change.type === 'delete') {
				removedIds.push(change.id)
			} else {
				const workStatus = change.status as any as Omit<ExpectedPackageStatusAPI.WorkStatus, 'fromPackages'> & {
					fromPackages: FromPackage[]
				}

				if (change.type === 'update') {
					// Partial update only:
					bulkChanges.push({
						updateOne: {
							filter: {
								_id: change.id,
							},
							update: {
								$set: {
									...workStatus,
									modified: getCurrentTime(),
								},
							},
						},
					})
				} else if (change.type === 'insert') {
					// For inserts, we need to look up the ExpectedPackage in order to put it in the right studio:
					check(workStatus.fromPackages, Array)
					const fromPackageIds = workStatus.fromPackages.map((p) => p.id)
					if (fromPackageIds.length) {
						ps.push(
							asyncCollectionFindOne(ExpectedPackages, { _id: { $in: fromPackageIds } }).then(
								(expPackage) => {
									if (!expPackage)
										throw new Meteor.Error(404, `ExpectedPackages "${fromPackageIds}" not found`)

									const doc: ExpectedPackageWorkStatus = {
										...workStatus,

										_id: change.id,
										studioId: expPackage.studioId,
										deviceId: peripheralDevice._id,

										modified: getCurrentTime(),
									}
									bulkChanges.push({
										replaceOne: {
											filter: {
												_id: change.id,
											},
											replacement: doc,
											upsert: true,
										},
									})
								}
							)
						)
					}
				} else {
					assertNever(change)
				}
			}
		}
		if (removedIds.length) {
			bulkChanges.push({
				deleteMany: {
					filter: {
						_id: { $in: removedIds as any },
					},
				},
			})
		}
		waitForPromiseAll(ps)
		waitForPromise(asyncCollectionBulkWrite(ExpectedPackageWorkStatuses, bulkChanges))
	}

	export function removeAllExpectedPackageWorkStatusOfDevice(
		context: MethodContext,
		deviceId: PeripheralDeviceId,
		deviceToken: string
	): void {
		const peripheralDevice = checkAccessAndGetPeripheralDevice(deviceId, deviceToken, context)

		ExpectedPackageWorkStatuses.remove({
			deviceId: peripheralDevice._id,
		})
	}

	export function updatePackageContainerPackageStatuses(
		context: MethodContext,
		deviceId: PeripheralDeviceId,
		deviceToken: string,
		changes: (
			| {
					containerId: string
					packageId: string
					type: 'delete'
			  }
			| {
					containerId: string
					packageId: string
					type: 'update'
					status: ExpectedPackageStatusAPI.PackageContainerPackageStatus
			  }
		)[]
	) {
		const peripheralDevice = checkAccessAndGetPeripheralDevice(deviceId, deviceToken, context)
		if (!peripheralDevice.studioId)
			throw new Meteor.Error(400, 'Device "' + peripheralDevice._id + '" has no studio')

		const studioId = peripheralDevice.studioId

		const removedIds: PackageContainerPackageId[] = []
		const ps: Promise<any>[] = []
		for (const change of changes) {
			check(change.containerId, String)
			check(change.packageId, String)

			const id = getPackageContainerPackageId(peripheralDevice.studioId, change.containerId, change.packageId)

			if (change.type === 'delete') {
				removedIds.push(id)
			} else if (change.type === 'update') {
				ps.push(
					Promise.resolve().then(() => {
						const updateCount = PackageContainerPackageStatuses.update(id, {
							$set: {
								status: change.status,
								modified: getCurrentTime(),
							},
						})
						if (updateCount === 0) {
							// The PackageContainerStatus doesn't exist
							// Create it on the fly:

							PackageContainerPackageStatuses.upsert(id, {
								$set: literal<PackageContainerPackageStatusDB>({
									_id: id,
									studioId: studioId,
									containerId: change.containerId,
									packageId: change.packageId,
									status: change.status,
									modified: getCurrentTime(),
								}),
							})
						}
					})
				)
			} else {
				assertNever(change)
			}
		}
		if (removedIds.length) {
			ps.push(asyncCollectionRemove(PackageContainerPackageStatuses, { _id: { $in: removedIds } }))
		}
		waitForPromiseAll(ps)
	}
	export function fetchPackageInfoMetadata(
		context: MethodContext,
		deviceId: PeripheralDeviceId,
		deviceToken: string,
		type: string,
		packageIds: ExpectedPackageId[]
	): { packageId: ExpectedPackageId; expectedContentVersionHash: string; actualContentVersionHash: string }[] {
		const peripheralDevice = checkAccessAndGetPeripheralDevice(deviceId, deviceToken, context)
		check(packageIds, Array)
		check(type, String)
		if (!peripheralDevice.studioId)
			throw new Meteor.Error(400, 'Device "' + peripheralDevice._id + '" has no studio')

		const ids = packageIds.map((packageId) => getPackageInfoId(packageId, type))
		const packageInfos = PackageInfos.find(
			{ _id: { $in: ids } },
			{
				fields: {
					payload: 0,
				},
			}
		).fetch()
		return packageInfos.map((packageInfo) => ({
			packageId: packageInfo.packageId,
			expectedContentVersionHash: packageInfo.expectedContentVersionHash,
			actualContentVersionHash: packageInfo.actualContentVersionHash,
		}))
	}
	export function updatePackageInfo(
		context: MethodContext,
		deviceId: PeripheralDeviceId,
		deviceToken: string,
		type: PackageInfoDBType, // string
		packageId: ExpectedPackageId,
		expectedContentVersionHash: string,
		actualContentVersionHash: string,
		payload: any
	): void {
		const peripheralDevice = checkAccessAndGetPeripheralDevice(deviceId, deviceToken, context)
		check(packageId, String)
		check(type, String)
		if (!peripheralDevice.studioId)
			throw new Meteor.Error(400, 'Device "' + peripheralDevice._id + '" has no studio')

		const id = getPackageInfoId(packageId, type)

		PackageInfos.upsert(id, {
			$set: literal<PackageInfoBase>({
				_id: id,

				packageId: packageId,
				expectedContentVersionHash: expectedContentVersionHash,
				actualContentVersionHash: actualContentVersionHash,

				studioId: peripheralDevice.studioId,

				deviceId: peripheralDevice._id,

				type: type,
				payload: payload,
			}) as PackageInfoDB,
		})
	}
	export function removePackageInfo(
		context: MethodContext,
		deviceId: PeripheralDeviceId,
		deviceToken: string,
		type: string,
		packageId: ExpectedPackageId
	): void {
		const peripheralDevice = checkAccessAndGetPeripheralDevice(deviceId, deviceToken, context)
		check(packageId, String)
		check(type, String)
		if (!peripheralDevice.studioId)
			throw new Meteor.Error(400, 'Device "' + peripheralDevice._id + '" has no studio')

		const id = getPackageInfoId(packageId, type)

		PackageInfos.remove(id)
	}
}
