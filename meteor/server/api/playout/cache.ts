import { ReadonlyDeep } from 'type-fest'
import _ from 'underscore'
import { PartInstance, DBPartInstance, PartInstances } from '../../../lib/collections/PartInstances'
import { Part, DBPart, Parts } from '../../../lib/collections/Parts'
import { PeripheralDevice, PeripheralDevices } from '../../../lib/collections/PeripheralDevices'
import { PieceInstance, PieceInstances } from '../../../lib/collections/PieceInstances'
import {
	RundownPlaylist,
	DBRundownPlaylist,
	RundownPlaylistId,
	RundownPlaylists,
} from '../../../lib/collections/RundownPlaylists'
import { Rundown, DBRundown, Rundowns } from '../../../lib/collections/Rundowns'
import { Segment, DBSegment, Segments } from '../../../lib/collections/Segments'
import { Studio, StudioId, Studios } from '../../../lib/collections/Studios'
import { Timeline, TimelineComplete } from '../../../lib/collections/Timeline'
import { waitForPromise } from '../../../lib/lib'
import { ActivationCache, getActivationCache } from '../../cache/ActivationCache'
import { DbCacheReadCollection, DbCacheWriteCollection } from '../../cache/CacheCollection'
import { DbCacheReadObject, DbCacheWriteObject } from '../../cache/CacheObject'
import { CacheBase } from '../../cache/CacheBase'
import { profiler } from '../profiler'
import { removeRundownPlaylistFromDb } from '../rundownPlaylist'
import { CacheForStudioBase } from '../studio/cache'
import { getRundownsSegmentsAndPartsFromCache } from './lib'

/**
 * This is a cache used for playout operations.
 * It is intentionally very lightweight, with the intention of it to be used only for some initial verification that a playout operation can be performed.
 */
export abstract class CacheForPlayoutPreInit extends CacheBase<CacheForPlayout> {
	public readonly isPlayout = true
	public readonly PlaylistId: RundownPlaylistId

	public readonly activationCache: ActivationCache

	public readonly Studio: DbCacheReadObject<Studio, Studio>
	public readonly PeripheralDevices: DbCacheReadCollection<PeripheralDevice, PeripheralDevice>

	public readonly Playlist: DbCacheWriteObject<RundownPlaylist, DBRundownPlaylist>
	public readonly Rundowns: DbCacheWriteCollection<Rundown, DBRundown> // TODO DbCacheReadCollection??

	protected constructor(studioId: StudioId, playlistId: RundownPlaylistId) {
		super()

		this.PlaylistId = playlistId
		this.activationCache = getActivationCache(studioId, playlistId)

		this.Studio = new DbCacheReadObject(Studios, false)
		this.PeripheralDevices = new DbCacheReadCollection(PeripheralDevices)

		this.Playlist = new DbCacheWriteObject(RundownPlaylists, false)
		this.Rundowns = new DbCacheWriteCollection(Rundowns)
	}

	protected async preInit(tmpPlaylist: ReadonlyDeep<RundownPlaylist>) {
		await Promise.allSettled([
			this.Playlist._initialize(tmpPlaylist._id),
			this.Rundowns.prepareInit({ playlistId: tmpPlaylist._id }, true),
		])

		const rundowns = this.Rundowns.findFetch()
		await this.activationCache.initialize(this.Playlist.doc, rundowns)

		this.Studio._fromDoc(this.activationCache.getStudio())
		await this.PeripheralDevices.prepareInit(async () => {
			const data = await this.activationCache.getPeripheralDevices()
			this.PeripheralDevices.fillWithDataFromArray(data)
		}, true)
	}
}

/**
 * This is a cache used for playout operations.
 * It contains everything that is needed to generate the timeline, and everything except for pieces needed to update the partinstances.
 * Anything not in this cache should not be needed often, and only for specific operations (eg, AdlibActions needed to run one).
 */
export class CacheForPlayout extends CacheForPlayoutPreInit implements CacheForStudioBase {
	private toBeRemoved: boolean = false

	public readonly Timeline: DbCacheWriteCollection<TimelineComplete, TimelineComplete>

	public readonly Segments: DbCacheReadCollection<Segment, DBSegment>
	public readonly Parts: DbCacheReadCollection<Part, DBPart>
	public readonly PartInstances: DbCacheWriteCollection<PartInstance, DBPartInstance>
	public readonly PieceInstances: DbCacheWriteCollection<PieceInstance, PieceInstance>

	protected constructor(studioId: StudioId, playlistId: RundownPlaylistId) {
		super(studioId, playlistId)

		this.Timeline = new DbCacheWriteCollection<TimelineComplete, TimelineComplete>(Timeline)

		this.Segments = new DbCacheReadCollection<Segment, DBSegment>(Segments)
		this.Parts = new DbCacheReadCollection<Part, DBPart>(Parts)

		this.PartInstances = new DbCacheWriteCollection<PartInstance, DBPartInstance>(PartInstances)
		this.PieceInstances = new DbCacheWriteCollection<PieceInstance, PieceInstance>(PieceInstances)
	}

	static async create(tmpPlaylist: ReadonlyDeep<RundownPlaylist>): Promise<CacheForPlayout> {
		const res = new CacheForPlayout(tmpPlaylist.studioId, tmpPlaylist._id)

		await res.preInit(tmpPlaylist)

		return res
	}

	// static async createForIngest(studioId: StudioId, playlistId: RundownPlaylistId): Promise<[CacheForPlayout]> {
	// 	// TODO - this is quite a hack...
	// 	const res: Mutable<CacheForPlayout> = new CacheForPlayout(studioId, playlistId)

	// 	res.Playlist = new DbCacheWriteOptionalObject(RundownPlaylists)

	// 	//

	// 	return [
	// 		res
	// 	]
	// }

	static async from(
		newPlaylist: ReadonlyDeep<RundownPlaylist>,
		newRundowns: ReadonlyDeep<Array<Rundown>>
	): Promise<CacheForPlayout> {
		const res = new CacheForPlayout(newPlaylist.studioId, newPlaylist._id)

		res.Playlist._fromDoc(newPlaylist)
		await res.Rundowns.prepareInit(async () => {
			res.Rundowns.fillWithDataFromArray(newRundowns)
		}, true)

		await res.preInit(res.Playlist.doc)

		await res.initContent()

		return res
	}

	async initContent(): Promise<void> {
		const playlist = this.Playlist.doc

		const ps: Promise<any>[] = []

		const rundownIds = this.Rundowns.findFetch().map((r) => r._id)

		const selectedPartInstanceIds = _.compact([
			playlist.currentPartInstanceId,
			playlist.nextPartInstanceId,
			playlist.previousPartInstanceId,
		])

		ps.push(this.Segments.prepareInit({ rundownId: { $in: rundownIds } }, true)) // TODO - omit if we cant or are unlikely to change the current part
		ps.push(this.Parts.prepareInit({ rundownId: { $in: rundownIds } }, true)) // TODO - omit if we cant or are unlikely to change the current part

		ps.push(
			this.PartInstances.prepareInit(
				{
					playlistActivationId: playlist.activationId,
					rundownId: { $in: rundownIds },
					reset: { $ne: true },
				},
				true
			)
		)

		ps.push(
			this.PieceInstances.prepareInit(
				{
					playlistActivationId: playlist.activationId,
					rundownId: { $in: rundownIds },
					partInstanceId: { $in: selectedPartInstanceIds },
					reset: { $ne: true },
				},
				true
			)
		)

		await Promise.allSettled(ps)

		// This will be needed later, but we will do some other processing first
		// TODO-CACHE how can we reliably defer this and await it when it is needed?
		await Promise.allSettled([this.Timeline.prepareInit({ _id: playlist.studioId }, true)])
	}

	removePlaylist() {
		// TODO - check if active
		this.toBeRemoved = true
	}

	discardChanges() {
		this.toBeRemoved = false
		super.discardChanges()
	}

	async saveAllToDatabase() {
		if (this.toBeRemoved) {
			const span = profiler.startSpan('CacheForPlayout.saveAllToDatabase')
			this._abortActiveTimeout()

			// TODO - run any of the defers?

			waitForPromise(removeRundownPlaylistFromDb(this.Playlist.doc))

			span?.end()
		} else {
			return super.saveAllToDatabase()
		}
	}
}

export function getOrderedSegmentsAndPartsFromPlayoutCache(
	cache: CacheForPlayout
): {
	segments: Segment[]
	parts: Part[]
} {
	const rundowns = cache.Rundowns.findFetch(
		{},
		{
			sort: {
				_rank: 1,
				_id: 1,
			},
		}
	)
	return getRundownsSegmentsAndPartsFromCache(cache.Parts, cache.Segments, rundowns)
}
export function getAllOrderedPartsFromPlayoutCache(cache: CacheForPlayout): Part[] {
	const { parts } = getOrderedSegmentsAndPartsFromPlayoutCache(cache)
	return parts
}
export function getRundownIDsFromCache(cache: CacheForPlayout) {
	return cache.Rundowns.findFetch({}).map((r) => r._id)
}
export function getSelectedPartInstancesFromCache(
	cache: CacheForPlayout
): {
	currentPartInstance: PartInstance | undefined
	nextPartInstance: PartInstance | undefined
	previousPartInstance: PartInstance | undefined
} {
	const playlist = cache.Playlist.doc

	return {
		currentPartInstance: playlist.currentPartInstanceId
			? cache.PartInstances.findOne(playlist.currentPartInstanceId)
			: undefined,
		nextPartInstance: playlist.nextPartInstanceId
			? cache.PartInstances.findOne(playlist.nextPartInstanceId)
			: undefined,
		previousPartInstance: playlist.previousPartInstanceId
			? cache.PartInstances.findOne(playlist.previousPartInstanceId)
			: undefined,
	}
}
