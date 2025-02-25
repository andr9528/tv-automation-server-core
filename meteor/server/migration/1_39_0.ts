import { addMigrationSteps } from './databaseMigration'
import { Parts } from '../../lib/collections/Parts'

/*
 * **************************************************************************************
 *
 *  These migrations are destined for the next release
 *
 * (This file is to be renamed to the correct version number when doing the release)
 *
 * **************************************************************************************
 */
// Release 39
export const addSteps = addMigrationSteps('1.39.0', [
	{
		id: `Parts.expectedDurationWithPreroll`,
		canBeRunAutomatically: true,
		validate: () => {
			const objects = Parts.find({
				expectedDurationWithPreroll: {
					$exists: false,
				},
			}).count()
			if (objects > 0) {
				return `timing is expectedDurationWithPreroll on ${objects} objects`
			}
			return false
		},
		migrate: () => {
			const objects = Parts.find({
				expectedDurationWithPreroll: {
					$exists: false,
				},
			}).fetch()
			for (const obj of objects) {
				Parts.update(obj._id, {
					$set: {
						expectedDurationWithPreroll: obj.expectedDuration,
					},
				})
			}
		},
	},
])
