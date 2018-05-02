import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { check } from 'meteor/check'
import * as _ from 'underscore'
import {
	IMOSConnectionStatus,
	IMOSDevice,
	IMOSListMachInfo,
	MosString128,
	MosTime,
	IMOSRunningOrder,
	IMOSRunningOrderBase,
	IMOSRunningOrderStatus,
	IMOSStoryStatus,
	IMOSItemStatus,
	IMOSStoryAction,
	IMOSROStory,
	IMOSROAction,
	IMOSItemAction,
	IMOSItem,
	IMOSROReadyToAir,
	IMOSROFullStory,
	IMOSStory,
	IMOSExternalMetaData
} from 'mos-connection'

import { PeripheralDeviceAPI } from '../../lib/api/peripheralDevice'

import { PeripheralDevices } from '../../lib/collections/PeripheralDevices'
import { RunningOrder, RunningOrders } from '../../lib/collections/RunningOrders'
import { SegmentLine, SegmentLines } from '../../lib/collections/SegmentLines'
import { SegmentLineItem, SegmentLineItems } from '../../lib/collections/SegmentLineItems'
import { Segment, Segments } from '../../lib/collections/Segments'

import { saveIntoDb, partialExceptId, getCurrentTime } from '../../lib/lib'
import { PeripheralDeviceSecurity } from '../security/peripheralDevices'

// import {ServerPeripheralDeviceAPIMOS as MOS} from './peripheralDeviceMos'
export namespace ServerPeripheralDeviceAPI {
	export function initialize (id: string, token: string, options: PeripheralDeviceAPI.InitOptions): string {
		check(id, String)
		check(token, String)
		check(options, Object)
		check(options.name, String)
		check(options.type, Number)

		console.log('initialize', options)

		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)

		if (!peripheralDevice) {
			// Add a new device

			PeripheralDevices.insert({
				_id: id,
				created: getCurrentTime(),
				status: {
					statusCode: PeripheralDeviceAPI.StatusCode.UNKNOWN
				},
				connected: true,
				connectionId: options.connectionId,
				lastSeen: getCurrentTime(),
				token: token,
				type: options.type,
				name: options.name

			})

		} else {
			// Update the device:

			PeripheralDevices.update(id, {$set: {
				lastSeen: getCurrentTime(),
				connected: true,
				connectionId: options.connectionId,
				type: options.type,
				name: options.name
			}})

		}
		return id
	}
	export function unInitialize (id: string, token: string): string {

		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		if (!peripheralDevice) throw new Meteor.Error(404,"peripheralDevice '" + id + "' not found!")

		// TODO: Add an authorization for this?

		PeripheralDevices.remove(id)
		return id
	}
	export function setStatus (id: string, token: string, status: PeripheralDeviceAPI.StatusObject): PeripheralDeviceAPI.StatusObject {
		check(id, String)
		check(token, String)
		check(status, Object)
		check(status.statusCode, Number)
		console.log('setStatus', status.statusCode)

		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		if (!peripheralDevice) throw new Meteor.Error(404,"peripheralDevice '" + id + "' not found!")

		// check if we have to update something:
		if (!_.isEqual(status, peripheralDevice.status)) {
			// perform the update:
			PeripheralDevices.update(id, {$set: {
				status: status
			}})
		}
		return status
	}
	export function getPeripheralDevice (id: string, token: string) {
		return PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
	}
	// export {P.initialize}
	// ----------------------------------------------------------------------------
// Mos-functions:
	export function mosRoCreate (id, token, ro: IMOSRunningOrder) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		
		console.log('mosRoCreate', ro)
		// Save RO into database:
		saveIntoDb(RunningOrders, {
			_id: roId(ro.ID)
		}, _.map([ro], (ro) => {
			return partialExceptId<RunningOrder>({
				_id: roId(ro.ID),
				mosId: ro.ID.toString(),
				// studioInstallationId: '',
				// showStyleId: '',
				name: ro.Slug.toString()
			})
		}), {
			beforeInsert: (o) => {
				o.created = getCurrentTime()
				return o
			}
		})

		// Save Stories (aka Segments) into database:
		let rank = 0
		saveIntoDb(Segments, {
			runningOrderId: roId(ro.ID)
		}, _.map(ro.Stories, (story: IMOSStory) => {
			return convertToSegment(story, roId(ro.ID), rank++)
		}),{
			afterInsert (segment) {
				let story: IMOSROStory | undefined = _.find(ro.Stories, (s) => { return s.ID.toString() === segment.mosId } )
				if (story) {
					afterInsertUpdateSegment (story, roId(ro.ID))
				} else throw new Meteor.Error(500, 'Story not found (it should have been)')
			},
			afterUpdate (segment) {
				let story: IMOSROStory | undefined = _.find(ro.Stories, (s) => { return s.ID.toString() === segment.mosId } )
				if (story) {
					afterInsertUpdateSegment (story, roId(ro.ID))
				} else throw new Meteor.Error(500, 'Story not found (it should have been)')
			},
			afterRemove (segment) {
				afterRemoveSegment(segment._id, segment.runningOrderId)
			}
		})
	}
	export function mosRoReplace (id, token, ro: IMOSRunningOrder) {
		// let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoReplace')
		return mosRoCreate(id, token, ro) // it's the same
	}
	export function mosRoDelete (id, token, runningOrderId: MosString128) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoDelete', runningOrderId)
		RunningOrders.remove(roId(runningOrderId))
		Segments.remove({runningOrderId: roId(runningOrderId)})
		SegmentLines.remove({runningOrderId: roId(runningOrderId)})
		SegmentLineItems.remove({ runningOrderId: roId(runningOrderId)})
	}
	export function mosRoMetadata (id, token, metadata: IMOSRunningOrderBase) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoMetadata')
		let ro = getRO(metadata.ID)
		if (metadata.MosExternalMetaData) {
			RunningOrders.update(ro._id, {$set: {
				metaData: metadata.MosExternalMetaData
			}})
		}
	}
	export function mosRoStatus (id, token, status: IMOSRunningOrderStatus) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoStatus')
		let ro = getRO(status.ID)
		RunningOrders.update(ro._id, {$set: {
			status: status.Status
		}})
	}
	export function mosRoStoryStatus (id, token, status: IMOSStoryStatus) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoStoryStatus')
		// Save Stories (aka Segments) status into database:
		let segment = Segments.findOne({
			_id: 			segmentId(roId(status.RunningOrderId), status.ID),
			runningOrderId: roId(status.RunningOrderId)
		})
		if (segment) {
			Segments.update(segment._id, {$set: {
				status: status.Status
			}})
		} else throw new Meteor.Error(404, 'Segment ' + status.ID + ' in RO ' + status.RunningOrderId + ' not found')
	}
	export function mosRoItemStatus (id, token, status: IMOSItemStatus) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoItemStatus')
		// Save Items (aka SegmentLines) into database:
		let segmentID = segmentId(roId(status.RunningOrderId), status.StoryId)
		let segmentLine = SegmentLines.findOne({
			_id: 			segmentLineId(segmentID, status.ID),
			segmentId: 		segmentID,
			runningOrderId: roId(status.RunningOrderId)
		})
		if (segmentLine) {
			SegmentLines.update(segmentLine._id, {$set: {
				status: status.Status
			}})
		} else throw new Meteor.Error(404, 'SegmentLine ' + status.ID + ' in segment ' + status.StoryId + ' in RO ' + status.RunningOrderId + ' not found')
	}
	export function mosRoStoryInsert (id, token, Action: IMOSStoryAction, Stories: Array<IMOSROStory>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		// console.log('mosRoStoryInsert')
		console.log('mosRoStoryInsert!', Action, Stories)
		// insert a story (aka Segment) before another story:
		let ro = getRO(Action.RunningOrderID)
		let segmentAfter = (Action.StoryID ? getSegment(Action.RunningOrderID, Action.StoryID) : null)

		let segmentBeforeOrLast
		let newRankMax
		let newRankMin
		if (segmentAfter) {
			segmentBeforeOrLast = fetchBefore(Segments,
				{ runningOrderId: roId(Action.RunningOrderID) },
				segmentAfter._rank
			)
		} else {
			segmentBeforeOrLast = fetchBefore(Segments,
				{ runningOrderId: roId(Action.RunningOrderID) },
				null
			)
		}
		_.each(Stories, (story: IMOSROStory, i: number) => {
			let rank = getRank(segmentBeforeOrLast, segmentAfter, i, Stories.length)
			// let rank = newRankMin + ( i / Stories.length ) * (newRankMax - newRankMin)
			insertSegment(story, ro._id, rank)
		})
	}
	export function mosRoItemInsert (id, token, Action: IMOSItemAction, Items: Array<IMOSItem>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoItemInsert')
		// insert an item (aka SegmentLine) before another story:
		let ro = getRO(Action.RunningOrderID)
		let segment = getSegment(Action.RunningOrderID, Action.StoryID)
		let segmentLineAfter = (Action.ItemID ? getSegmentLine(Action.RunningOrderID, Action.StoryID, Action.ItemID) : null)

		let segmentLineBeforeOrLast
		let newRankMax
		let newRankMin
		if (segmentLineAfter) {
			segmentLineBeforeOrLast = fetchBefore(SegmentLines,
				{ runningOrderId: ro._id, segmentId: segment._id },
				segmentLineAfter._rank
			)
		} else {
			segmentLineBeforeOrLast = fetchBefore(SegmentLines,
				{ runningOrderId: ro._id, segmentId: segment._id },
				null
			)
		}
		_.each(Items, (item: IMOSItem, i: number) => {
			let rank = getRank(segmentLineBeforeOrLast, segmentLineAfter, i, Items.length)
			// let rank = newRankMin + ( i / Items.length ) * (newRankMax - newRankMin)
			insertSegmentLine(item, ro._id, segment._id, rank)
		})
	}
	export function mosRoStoryReplace (id, token, Action: IMOSStoryAction, Stories: Array<IMOSROStory>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoStoryReplace')
		// Replace a Story (aka a Segment) with one or more Stories
		let ro = getRO(Action.RunningOrderID)
		let segmentToReplace = getSegment(Action.RunningOrderID, Action.StoryID)

		let segmentBefore = fetchBefore(Segments, { runningOrderId: ro._id }, segmentToReplace._rank)
		let segmentAfter = fetchAfter(Segments, { runningOrderId: ro._id }, segmentToReplace._rank)

		removeSegment(segmentToReplace._id, segmentToReplace.runningOrderId)

		_.each(Stories, (story: IMOSROStory, i: number) => {
			let rank = getRank(segmentBefore, segmentAfter, i, Stories.length)
			insertSegment(story, roId(Action.RunningOrderID), rank)
		})
	}
	export function mosRoItemReplace (id, token, Action: IMOSItemAction, Items: Array<IMOSItem>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoItemReplace')
		// Replace an item (aka SegmentLine) with one or more items
		let ro = getRO(Action.RunningOrderID)
		let segmentLineToReplace = getSegmentLine(Action.RunningOrderID, Action.StoryID, Action.ItemID)

		let segmentLineBefore = fetchBefore(SegmentLines, { runningOrderId: ro._id, segmentId: segmentLineToReplace.segmentId }, segmentLineToReplace._rank)
		let segmentLineAfter = fetchAfter(SegmentLines, { runningOrderId: ro._id, segmentId: segmentLineToReplace.segmentId }, segmentLineToReplace._rank)

		removeSegmentLine(segmentLineToReplace._id)

		_.each(Items, (item: IMOSItem, i: number) => {
			let rank = getRank (segmentLineBefore, segmentLineAfter, i, Items.length)
			insertSegmentLine(item, ro._id, segmentLineToReplace.segmentId, rank)
		})
	}
	export function mosRoStoryMove (id, token, Action: IMOSStoryAction, Stories: Array<MosString128>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoStoryMove')
		// Move Stories (aka Segments) to before a story
		let ro = getRO(Action.RunningOrderID)
		let segmentAfter = getSegment(Action.RunningOrderID, Action.StoryID)
		let segmentBefore = fetchBefore(Segments, { runningOrderId: ro._id }, segmentAfter._rank)

		_.each(Stories, (storyId: MosString128, i: number) => {
			let rank = getRank(segmentBefore, segmentAfter, i, Stories.length)
			Segments.update(segmentId(ro._id, storyId), {$set: {
				_rank: rank
			}})
		})
	}
	export function mosRoItemMove (id, token, Action: IMOSItemAction, Items: Array<MosString128>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoItemMove')
		// Move Items (aka SegmentLines) to before a story
		let ro = getRO(Action.RunningOrderID)
		let segmentLineAfter = getSegmentLine(Action.RunningOrderID, Action.StoryID, Action.ItemID)
		let segmentLineBefore = fetchBefore(SegmentLines,
			{ runningOrderId: ro._id, segmentId: segmentLineAfter.segmentId},
			segmentLineAfter._rank)

		_.each(Items, (itemId: MosString128, i: number) => {
			let rank = getRank(segmentLineBefore, segmentLineAfter, i, Items.length)
			SegmentLines.update(segmentLineId(segmentLineAfter.segmentId, itemId), {$set: {
				_rank: rank
			}})
		})
	}
	export function mosRoStoryDelete (id, token, Action: IMOSROAction, Stories: Array<MosString128>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoStoryDelete')
		// Delete Stories (aka Segments)
		let ro = getRO(Action.RunningOrderID)
		_.each(Stories, (storyId: MosString128, i: number) => {
			removeSegment(segmentId(ro._id,storyId), ro._id)
		})
	}
	export function mosRoItemDelete (id, token, Action: IMOSStoryAction, Items: Array<MosString128>) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoItemDelete')
		// Delete Items (aka SegmentsLines)
		let ro = getRO(Action.RunningOrderID)
		_.each(Items, (itemId: MosString128, i: number) => {
			removeSegmentLine( segmentLineId(segmentId(ro._id, Action.StoryID), itemId))
		})
	}
	export function mosRoStorySwap (id, token, Action: IMOSROAction, StoryID0: MosString128, StoryID1: MosString128) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoStorySwap')
		// Swap Stories (aka Segments)
		let ro = getRO(Action.RunningOrderID)

		let segment0 = getSegment(Action.RunningOrderID, StoryID0)
		let segment1 = getSegment(Action.RunningOrderID, StoryID1)

		Segments.update(segment0._id, {$set: {_rank: segment1._rank}})
		Segments.update(segment1._id, {$set: {_rank: segment0._rank}})
	}
	export function mosRoItemSwap (id, token, Action: IMOSStoryAction, ItemID0: MosString128, ItemID1: MosString128) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoItemSwap')
		// Swap Stories (aka Segments)
		let ro = getRO(Action.RunningOrderID)

		let segmentLine0 = getSegmentLine(Action.RunningOrderID, Action.StoryID, ItemID0)
		let segmentLine1 = getSegmentLine(Action.RunningOrderID, Action.StoryID, ItemID1)

		Segments.update(segmentLine0._id, {$set: {_rank: segmentLine1._rank}})
		Segments.update(segmentLine1._id, {$set: {_rank: segmentLine0._rank}})
	}
	export function mosRoReadyToAir (id, token, Action: IMOSROReadyToAir) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoReadyToAir')
		// Set the ready to air status of a Running Order
		console.log('mosRoReadyToAir')
		let ro = getRO(Action.ID)

		RunningOrders.update(ro._id, {$set: {
			airStatus: Action.Status
		}})

	}
	export function mosRoFullStory (id, token, story: IMOSROFullStory ) {
		let peripheralDevice = PeripheralDeviceSecurity.getPeripheralDevice(id, token, this)
		console.log('mosRoFullStory')
		// Update db with the full story:
		let ro = getRO(story.RunningOrderId)
		// TODO: Do something

		// return this.core.mosManipulate(P.methods.mosRoReadyToAir, story)
	}
}
export function roId (roId: MosString128): string {
	// console.log('roId', roId)
	return 'ro_' + roId.toString()
}
export function segmentId (roId: string, storyId: MosString128): string {
	return roId + '_' + storyId.toString()
}
export function segmentLineId (segmentId: string, itemId: MosString128): string {
	return segmentId + '_' + itemId.toString()
}
/**
 * Returns a Running order, throws error if not found
 * @param roId Id of the Running order
 */
export function getRO (roID: MosString128): RunningOrder {
	let id = roId(roID)
	let ro = RunningOrders.findOne(id)
	if (ro) {
		return ro
	} else throw new Meteor.Error(404, 'RunningOrder ' + id + ' not found')
}
/**
 * Returns a Segment (aka a Story), throws error if not found
 * @param roId Running order id
 * @param segmentId Segment / Story id
 */
export function getSegment (roID: MosString128, segmentID: MosString128): Segment {
	let id = segmentId(roId(roID), segmentID)
	let segments = Segments.findOne({
		runningOrderId: roId(roID),
		_id: id
	})
	if (segments) {
		return segments
	} else throw new Meteor.Error(404, 'Segment ' + id + ' not found')
}
/**
 * Returns a SegmentLine (aka an Item), throws error if not found
 * @param roId
 * @param segmentLineId
 */
export function getSegmentLine (roID: MosString128, segmentID: MosString128, segmentLineID: MosString128): SegmentLine {
	let id = segmentLineId(segmentId(roId(roID), segmentID), segmentLineID)
	let segmentLines = SegmentLines.findOne({
		runningOrderId: roId( roID ),
		_id: id
	})
	if (segmentLines) {
		return segmentLines
	} else throw new Meteor.Error(404, 'SegmentLine ' + id + ' not found')
}
/**
 * Converts a Story into a Segment
 * @param story MOS Sory
 * @param runningOrderId Running order id of the story
 * @param rank Rank of the story
 */
export function convertToSegment (story: IMOSStory, runningOrderId: string, rank: number): Segment {
	return {
		_id: segmentId(runningOrderId, story.ID),
		runningOrderId: runningOrderId,
		_rank: rank,
		mosId: story.ID.toString(),
		name: (story.Slug ? story.Slug.toString() : ''),
		number: (story.Number ? story.Number.toString() : '')
	}
	// console.log('story.Number', story.Number)
}
/**
 * Converts an Item into a SegmentLine
 * @param item MOS Item
 * @param runningOrderId Running order id of the item
 * @param segmentId Segment / Story id of the item
 * @param rank Rank of the story
 */
export function convertToSegmentLine (item: IMOSItem, runningOrderId: string, segmentId: string, rank: number): SegmentLine {
	return {
		_id: segmentLineId(segmentId, item.ID),
		runningOrderId: runningOrderId,
		segmentId: segmentId,
		_rank: rank,
		mosId: item.ID.toString()
	}
}
/**
 * Insert a Story (aka a Segment) into the database
 * @param story The story to be inserted
 * @param runningOrderId The Running order id to insert into
 * @param rank The rank (position) to insert at
 */
export function insertSegment (story: IMOSROStory, runningOrderId: string, rank: number) {
	let segment = convertToSegment(story, runningOrderId, rank)
	Segments.upsert(segment._id, {$set: _.omit(segment,['_id']) })
	afterInsertUpdateSegment(story, runningOrderId)
}
/**
 * Removes a Story (aka a Segment) into the database
 * @param story The story to be inserted
 * @param runningOrderId The Running order id to insert into
 * @param rank The rank (position) to insert at
 */
export function removeSegment (segmentId: string, runningOrderId: string) {
	Segments.remove(segmentId)
	afterRemoveSegment(segmentId, runningOrderId)
}
/**
 * After a Story (aka a Segment) has been inserted / updated, handle its contents
 * @param story The Story that was inserted / updated
 * @param runningOrderId Id of the Running Order that contains the story
 */
export function afterInsertUpdateSegment (story: IMOSROStory, runningOrderId: string) {
	// Save Items (aka SegmentLines) into database:

	let segment = convertToSegment(story, runningOrderId, 0)
	let rank = 0
	saveIntoDb(SegmentLines, {
		runningOrderId: runningOrderId,
		segmentId: segment._id
	}, _.map(story.Items, (item: IMOSItem) => {
		return convertToSegmentLine(item, runningOrderId, segment._id, rank++)
	}), {
		afterInsert (o) {
			let item: IMOSItem | undefined = _.find(story.Items, (s) => { return s.ID.toString() === o.mosId } )
			if (item) {
				afterInsertUpdateSegmentLine(item, runningOrderId, segment._id)
			} else throw new Meteor.Error(500, 'Item not found (it should have been)')
		},
		afterUpdate (o) {
			let item: IMOSItem | undefined = _.find(story.Items, (s) => { return s.ID.toString() === o.mosId } )
			if (item) {
				afterInsertUpdateSegmentLine(item, runningOrderId, segment._id)
			} else throw new Meteor.Error(500, 'Item not found (it should have been)')
		},
		afterRemove (o) {
			afterRemoveSegmentLine(o._id)
		}
	})
}
/**
 * After a Segment has beed removed, handle its contents
 * @param segmentId Id of the Segment
 * @param runningOrderId Id of the Running order
 */
export function afterRemoveSegment (segmentId: string, runningOrderId: string) {
	// Remove the segment lines:
	saveIntoDb(SegmentLines, {
		runningOrderId: runningOrderId,
		segmentId: segmentId
	},[],{
		remove (segment) {
			removeSegmentLine(segment._id)
		}
	})
}
/**
 * Insert a new SegmentLine (aka an Item)
 * @param item The item to be inserted
 * @param runningOrderId The id of the Running order
 * @param segmentId The id of the Segment / Story
 * @param rank The new rank of the SegmentLine
 */
export function insertSegmentLine (item: IMOSItem, runningOrderId: string, segmentId: string, rank: number) {
	SegmentLines.insert(convertToSegmentLine(item, runningOrderId, segmentId, rank))
	afterInsertUpdateSegmentLine(item, runningOrderId, segmentId)
}
export function removeSegmentLine (segmentLineId: string) {
	SegmentLines.remove(segmentLineId)
	afterRemoveSegmentLine(segmentLineId)
}
export function afterInsertUpdateSegmentLine (item: IMOSItem, runningOrderId: string, segmentId: string) {
	// TODO: create segmentLineItems

	// use the Template-generator to generate the segmentLineItems
	// and put them into the db
}
export function afterRemoveSegmentLine (segmentLineId: string) {
	SegmentLineItems.remove({
		segmentLineId: segmentLineId
	})
}
export function fetchBefore<T> (collection: Mongo.Collection<T>, selector: Mongo.Selector, rank: number | null): T {
	if (_.isNull(rank)) rank = Number.POSITIVE_INFINITY
	return collection.find(_.extend(selector, {
		_rank: {$lt: rank}
	}), {
		sort: {
			_rank: -1,
			_id: -1
		},
		limit: 1
	}).fetch()[0]
}
export function fetchAfter<T> (collection: Mongo.Collection<T>, selector: Mongo.Selector, rank: number | null): T {
	if (_.isNull(rank)) rank = Number.NEGATIVE_INFINITY
	return collection.find(_.extend(selector, {
		_rank: {$gt: rank}
	}), {
		sort: {
			_rank: 1,
			_id: 1
		},
		limit: 1
	}).fetch()[0]
}
export function getRank (beforeOrLast, after, i: number, count: number): number {
	let newRankMax
	let newRankMin

	if (after) {
		if (beforeOrLast) {
			newRankMin = beforeOrLast._rank
			newRankMax = after._rank
		} else {
			// First
			newRankMin = after._rank - 1
			newRankMax = after._rank
		}
	} else {
		if (beforeOrLast) {
			// Last
			newRankMin = beforeOrLast._rank
			newRankMax = beforeOrLast._rank + 1
		} else {
			// Empty list
			newRankMin = 0
			newRankMax = 1
		}
	}
	return newRankMin + ( (i + 1) / (count + 1) ) * (newRankMax - newRankMin)
}

const methods = {}
methods[PeripheralDeviceAPI.methods.initialize] = (deviceId, deviceToken, options) => {
	return ServerPeripheralDeviceAPI.initialize(deviceId, deviceToken, options)
}
methods[PeripheralDeviceAPI.methods.unInitialize] = (deviceId, deviceToken) => {
	return ServerPeripheralDeviceAPI.unInitialize(deviceId, deviceToken)
}
methods[PeripheralDeviceAPI.methods.setStatus] = (deviceId, deviceToken, status) => {
	return ServerPeripheralDeviceAPI.setStatus(deviceId, deviceToken, status)
}
methods[PeripheralDeviceAPI.methods.getPeripheralDevice ] = (deviceId, deviceToken) => {
	return ServerPeripheralDeviceAPI.getPeripheralDevice(deviceId, deviceToken)
}
// ----------------------------------------------------------------------------
// Mos-functions:
methods[PeripheralDeviceAPI.methods.mosRoCreate] = (deviceId, deviceToken, ro: IMOSRunningOrder) => {
	return ServerPeripheralDeviceAPI.mosRoCreate(deviceId, deviceToken, ro)
}
methods[PeripheralDeviceAPI.methods.mosRoReplace] = (deviceId, deviceToken, ro: IMOSRunningOrder) => {
	return ServerPeripheralDeviceAPI.mosRoReplace(deviceId, deviceToken, ro)
}
methods[PeripheralDeviceAPI.methods.mosRoDelete] = (deviceId, deviceToken, runningOrderId: MosString128) => {
	return ServerPeripheralDeviceAPI.mosRoDelete(deviceId, deviceToken, runningOrderId)
}
methods[PeripheralDeviceAPI.methods.mosRoMetadata] = (deviceId, deviceToken, metadata: IMOSRunningOrderBase) => {
	return ServerPeripheralDeviceAPI.mosRoMetadata(deviceId, deviceToken, metadata)
}
methods[PeripheralDeviceAPI.methods.mosRoStatus] = (deviceId, deviceToken, status: IMOSRunningOrderStatus) => {
	return ServerPeripheralDeviceAPI.mosRoStatus(deviceId, deviceToken, status)
}
methods[PeripheralDeviceAPI.methods.mosRoStoryStatus] = (deviceId, deviceToken, status: IMOSStoryStatus) => {
	return ServerPeripheralDeviceAPI.mosRoStoryStatus(deviceId, deviceToken, status)
}
methods[PeripheralDeviceAPI.methods.mosRoItemStatus] = (deviceId, deviceToken, status: IMOSItemStatus) => {
	return ServerPeripheralDeviceAPI.mosRoItemStatus(deviceId, deviceToken, status)
}
methods[PeripheralDeviceAPI.methods.mosRoStoryInsert] = (deviceId, deviceToken, Action: IMOSStoryAction, Stories: Array<IMOSROStory>) => {
	return ServerPeripheralDeviceAPI.mosRoStoryInsert(deviceId, deviceToken, Action, Stories)
}
methods[PeripheralDeviceAPI.methods.mosRoItemInsert] = (deviceId, deviceToken, Action: IMOSItemAction, Items: Array<IMOSItem>) => {
	return ServerPeripheralDeviceAPI.mosRoItemInsert(deviceId, deviceToken, Action, Items)
}
methods[PeripheralDeviceAPI.methods.mosRoStoryReplace] = (deviceId, deviceToken, Action: IMOSStoryAction, Stories: Array<IMOSROStory>) => {
	return ServerPeripheralDeviceAPI.mosRoStoryReplace(deviceId, deviceToken, Action, Stories)
}
methods[PeripheralDeviceAPI.methods.mosRoItemReplace] = (deviceId, deviceToken, Action: IMOSItemAction, Items: Array<IMOSItem>) => {
	return ServerPeripheralDeviceAPI.mosRoItemReplace(deviceId, deviceToken, Action, Items)
}
methods[PeripheralDeviceAPI.methods.mosRoStoryMove] = (deviceId, deviceToken, Action: IMOSStoryAction, Stories: Array<MosString128>) => {
	return ServerPeripheralDeviceAPI.mosRoStoryMove(deviceId, deviceToken, Action, Stories)
}
methods[PeripheralDeviceAPI.methods.mosRoItemMove] = (deviceId, deviceToken, Action: IMOSItemAction, Items: Array<MosString128>) => {
	return ServerPeripheralDeviceAPI.mosRoItemMove(deviceId, deviceToken, Action, Items)
}
methods[PeripheralDeviceAPI.methods.mosRoStoryDelete] = (deviceId, deviceToken, Action: IMOSROAction, Stories: Array<MosString128>) => {
	return ServerPeripheralDeviceAPI.mosRoStoryDelete(deviceId, deviceToken, Action, Stories)
}
methods[PeripheralDeviceAPI.methods.mosRoItemDelete] = (deviceId, deviceToken, Action: IMOSStoryAction, Items: Array<MosString128>) => {
	return ServerPeripheralDeviceAPI.mosRoItemDelete(deviceId, deviceToken, Action, Items)
}
methods[PeripheralDeviceAPI.methods.mosRoStorySwap] = (deviceId, deviceToken, Action: IMOSROAction, StoryID0: MosString128, StoryID1: MosString128) => {
	return ServerPeripheralDeviceAPI.mosRoStorySwap(deviceId, deviceToken, Action, StoryID0, StoryID1)
}
methods[PeripheralDeviceAPI.methods.mosRoItemSwap] = (deviceId, deviceToken, Action: IMOSStoryAction, ItemID0: MosString128, ItemID1: MosString128) => {
	return ServerPeripheralDeviceAPI.mosRoItemSwap(deviceId, deviceToken, Action, ItemID0, ItemID1)
}
methods[PeripheralDeviceAPI.methods.mosRoReadyToAir] = (deviceId, deviceToken, Action: IMOSROReadyToAir) => {
	return ServerPeripheralDeviceAPI.mosRoReadyToAir(deviceId, deviceToken, Action)
}
methods[PeripheralDeviceAPI.methods.mosRoFullStory] = (deviceId, deviceToken, story: IMOSROFullStory) => {
	return ServerPeripheralDeviceAPI.mosRoFullStory(deviceId, deviceToken, story)
}

// Apply methods:
Meteor.methods(methods)
