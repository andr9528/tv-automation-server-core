import {
	Time,
	getPartGroupId,
	getPartFirstObjectId,
	TimelineObjectCoreExt,
	getPieceGroupId,
	TimelineObjHoldMode,
	OnGenerateTimelineObj,
	TSR,
	PieceLifespan,
} from 'tv-automation-sofie-blueprints-integration'
import { DeepReadonly } from 'utility-types'
import { logger } from '../../../lib/logging'
import {
	TimelineObjGeneric,
	TimelineObjRundown,
	TimelineObjStat,
	TimelineObjType,
	TimelineContentTypeOther,
	TimelineObjRecording,
	TimelineObjGroupPart,
	TimelineObjPartAbstract,
	getTimelineId,
	TimelineObjGroupRundown,
} from '../../../lib/collections/Timeline'
import { Studio, StudioId } from '../../../lib/collections/Studios'
import { Meteor } from 'meteor/meteor'
import {
	waitForPromise,
	getHash,
	stringifyObjects,
	getCurrentTime,
	extendMandadory,
	literal,
	omit,
	protectString,
	unprotectString,
	unprotectObjectArray,
	unprotectObject,
	normalizeArrayFunc,
	clone,
	makePromise,
	asyncCollectionFindOne,
} from '../../../lib/lib'
import { RundownPlaylist, RundownPlaylistId } from '../../../lib/collections/RundownPlaylists'
import { Rundown, RundownHoldState } from '../../../lib/collections/Rundowns'
import { RundownBaselineObj } from '../../../lib/collections/RundownBaselineObjs'
import * as _ from 'underscore'
import { getLookeaheadObjects } from './lookahead'
import { loadStudioBlueprints, getBlueprintOfRundown } from '../blueprints/cache'
import { StudioContext, PartEventContext } from '../blueprints/context'
import { postProcessStudioBaselineObjects } from '../blueprints/postProcess'
import { generateRecordingTimelineObjs } from '../testTools'
import { Part, PartId } from '../../../lib/collections/Parts'
import { prefixAllObjectIds, getSelectedPartInstancesFromCache, getAllPieceInstancesFromCache } from './lib'
import { createPieceGroupFirstObject, getResolvedPiecesFromFullTimeline } from './pieces'
import { PackageInfo } from '../../coreSystem'
import { offsetTimelineEnableExpression } from '../../../lib/Rundown'
import { PartInstance, PartInstanceId } from '../../../lib/collections/PartInstances'
import { PieceInstance } from '../../../lib/collections/PieceInstances'
import { CacheForRundownPlaylist, CacheForStudio, CacheForStudioBase } from '../../DatabaseCaches'
import { saveIntoCache } from '../../DatabaseCache'
import { processAndPrunePieceInstanceTimings, PieceInstanceWithTimings } from '../../../lib/rundown/infinites'
import { createPieceGroupAndCap } from '../../../lib/rundown/pieces'
import { ShowStyleBase, ShowStyleBases } from '../../../lib/collections/ShowStyleBases'
import { DEFINITELY_ENDED_FUTURE_DURATION } from './infinites'

/**
 * Updates the Timeline to reflect the state in the Rundown, Segments, Parts etc...
 * @param studioId id of the studio to update
 * @param forceNowToTime if set, instantly forces all "now"-objects to that time (used in autoNext)
 */
// export const updateTimeline: (cache: CacheForRundownPlaylist, studioId: StudioId, forceNowToTime?: Time) => void
// = syncFunctionIgnore(function updateTimeline (cache: CacheForRundownPlaylist, studioId: StudioId, forceNowToTime?: Time) {
export function updateTimeline(cache: CacheForRundownPlaylist, studioId: StudioId, forceNowToTime?: Time) {
	logger.debug('updateTimeline running...')
	const studio = cache.activationCache.getStudio()
	const activePlaylist = getActiveRundownPlaylist(cache, studioId)

	if (activePlaylist && cache.containsDataFromPlaylist !== activePlaylist._id) {
		throw new Meteor.Error(500, `Active rundownPlaylist is not in cache`)
	}

	if (!studio) throw new Meteor.Error(404, 'studio "' + studioId + '" not found!')

	const timelineObjs: Array<TimelineObjGeneric> = [
		...getTimelineRundown(cache, studio),
		...getTimelineRecording(cache, studio),
	]

	processTimelineObjects(studio, timelineObjs)

	if (forceNowToTime) {
		// used when autoNexting
		setNowToTimeInObjects(timelineObjs, forceNowToTime)
	}

	let savedTimelineObjs: TimelineObjGeneric[] = []
	saveIntoCache<TimelineObjGeneric, TimelineObjGeneric>(
		cache.Timeline,
		{
			studioId: studio._id,
			objectType: { $ne: TimelineObjType.STAT },
		},
		timelineObjs,
		{
			beforeUpdate: (o: TimelineObjGeneric, oldO: TimelineObjGeneric): TimelineObjGeneric => {
				// do not overwrite enable when the enable has been denowified
				if (o.enable.start === 'now' && oldO.enable.setFromNow) {
					o.enable.start = oldO.enable.start
					o.enable.setFromNow = true
				}
				savedTimelineObjs.push(o)
				return o
			},
			afterInsert: (o: TimelineObjGeneric) => {
				savedTimelineObjs.push(o)
			},
			unchanged: (o: TimelineObjGeneric) => {
				savedTimelineObjs.push(o)
			},
		}
	)

	afterUpdateTimeline(cache, studio._id, savedTimelineObjs)

	logger.debug('updateTimeline done!')
}
// '$1') // This causes syncFunctionIgnore to only use the second argument (studioId) when ignoring

/**
 * To be called after an update to the timeline has been made, will add/update the "statObj" - an object
 * containing the hash of the timeline, used to determine if the timeline should be updated in the gateways
 * @param studioId id of the studio to update
 */
export function afterUpdateTimeline(
	cache: CacheForStudioBase,
	studioId: StudioId,
	timelineObjs?: Array<TimelineObjGeneric>
) {
	// logger.info('afterUpdateTimeline')
	if (!timelineObjs) {
		timelineObjs = cache.Timeline.findFetch({
			studioId: studioId,
			objectType: { $ne: TimelineObjType.STAT },
		})
	}

	// Number of objects
	let objCount = timelineObjs.length
	// Hash of all objects
	timelineObjs.sort((a, b) => {
		if (a._id < b._id) return 1
		if (a._id > b._id) return -1
		return 0
	})
	let objHash = getHash(stringifyObjects(timelineObjs))

	// save into "magic object":
	let statObj: TimelineObjStat = {
		id: 'statObj',
		_id: protectString(''), // set later
		studioId: studioId,
		objectType: TimelineObjType.STAT,
		content: {
			deviceType: TSR.DeviceType.ABSTRACT,
			type: TimelineContentTypeOther.NOTHING,
			modified: getCurrentTime(),
			objCount: objCount,
			objHash: objHash,
		},
		enable: { start: 0 },
		layer: '__stat',
	}
	statObj._id = getTimelineId(statObj)

	cache.Timeline.upsert(statObj._id, statObj)
}
export function getActiveRundownPlaylist(cache: CacheForStudioBase, studioId: StudioId): RundownPlaylist | undefined {
	return cache.RundownPlaylists.findOne({
		studioId: studioId,
		active: true,
	})
}
/**
 * Returns timeline objects related to rundowns in a studio
 */
function getTimelineRundown(cache: CacheForRundownPlaylist, studio: Studio): TimelineObjRundown[] {
	try {
		let timelineObjs: Array<TimelineObjGeneric & OnGenerateTimelineObj> = []

		const playlist = getActiveRundownPlaylist(cache, studio._id) // todo: is this correct?
		let activeRundown: Rundown | undefined

		let currentPartInstance: PartInstance | undefined
		let nextPartInstance: PartInstance | undefined

		if (playlist) {
			;({ currentPartInstance, nextPartInstance } = getSelectedPartInstancesFromCache(cache, playlist))

			const partForRundown = currentPartInstance || nextPartInstance

			activeRundown = partForRundown && cache.Rundowns.findOne(partForRundown.rundownId)
		}

		if (playlist && activeRundown) {
			// Fetch showstyle blueprint:
			const activeRundown0 = activeRundown
			const pShowStyle = asyncCollectionFindOne(ShowStyleBases, activeRundown.showStyleBaseId)
			const pshowStyleBlueprint = pShowStyle.then((showStyle) => getBlueprintOfRundown(showStyle, activeRundown0))

			// Fetch baseline
			const baselineItems = cache.RundownBaselineObjs.findFetch({
				rundownId: activeRundown._id,
			})

			// next (on pvw (or on pgm if first))
			const pLookaheadObjs = getLookeaheadObjects(cache, studio, playlist)

			const showStyle = waitForPromise(pShowStyle)
			if (!showStyle) {
				throw new Meteor.Error(
					404,
					`ShowStyleBase "${activeRundown.showStyleBaseId}" not found! (referenced by Rundown "${activeRundown._id}")`
				)
			}

			timelineObjs = timelineObjs.concat(buildTimelineObjsForRundown(cache, showStyle, baselineItems, playlist))

			timelineObjs = timelineObjs.concat(waitForPromise(pLookaheadObjs))

			const showStyleBlueprint0 = waitForPromise(pshowStyleBlueprint)
			const showStyleBlueprintManifest = showStyleBlueprint0.blueprint

			if (showStyleBlueprintManifest.onTimelineGenerate && currentPartInstance) {
				const currentPart = currentPartInstance
				const context = new PartEventContext(activeRundown, cache, studio, currentPart)
				const resolvedPieces = getResolvedPiecesFromFullTimeline(cache, playlist, timelineObjs)
				try {
					const tlGenRes = waitForPromise(
						showStyleBlueprintManifest.onTimelineGenerate(
							context,
							timelineObjs,
							playlist.previousPersistentState,
							currentPart.previousPartEndState,
							unprotectObjectArray(resolvedPieces.pieces)
						)
					)
					timelineObjs = _.map(tlGenRes.timeline, (object: OnGenerateTimelineObj) => {
						return literal<TimelineObjGeneric & OnGenerateTimelineObj>({
							...object,
							_id: protectString(''), // set later
							objectType: TimelineObjType.RUNDOWN,
							studioId: studio._id,
						})
					})
					if (tlGenRes.persistentState) {
						cache.RundownPlaylists.update(playlist._id, {
							$set: {
								previousPersistentState: tlGenRes.persistentState,
							},
						})
					}
				} catch (e) {
					logger.error(`Error in onTimelineGenerate during getTimelineRundown`, e)
				}
			}

			return timelineObjs.map<TimelineObjRundown>((timelineObj) => {
				return {
					...omit(timelineObj, 'pieceInstanceId', 'infinitePieceId'), // temporary fields from OnGenerateTimelineObj
					objectType: TimelineObjType.RUNDOWN,
				}
			})
		} else {
			let studioBaseline: TimelineObjRundown[] = []

			const studioBlueprint = loadStudioBlueprints(studio)
			if (studioBlueprint) {
				const blueprint = studioBlueprint.blueprint
				const baselineObjs = blueprint.getBaseline(new StudioContext(studio))
				studioBaseline = postProcessStudioBaselineObjects(studio, baselineObjs)

				const id = `baseline_version`
				studioBaseline.push(
					literal<TimelineObjRundown>({
						id: id,
						_id: protectString(''), // set later
						studioId: protectString(''), // set later
						objectType: TimelineObjType.RUNDOWN,
						enable: { start: 0 },
						layer: id,
						metaData: {
							versions: {
								core: PackageInfo.versionExtended || PackageInfo.version,
								blueprintId: studio.blueprintId,
								blueprintVersion: blueprint.blueprintVersion,
								studio: studio._rundownVersionHash,
							},
						},
						content: {
							deviceType: TSR.DeviceType.ABSTRACT,
						},
					})
				)
			}

			return studioBaseline
		}
	} catch (e) {
		logger.error(e)
		return []
	}
}
/**
 * Returns timeline objects related to Test Recordings in a studio
 */
function getTimelineRecording(
	cache: CacheForRundownPlaylist,
	studio: Studio,
	forceNowToTime?: Time
): TimelineObjRecording[] {
	try {
		let recordingTimelineObjs: TimelineObjRecording[] = []

		cache.RecordedFiles.findFetch(
			{
				// TODO: ask Julian if this is okay, having multiple recordings at the same time?
				studioId: studio._id,
				stoppedAt: { $exists: false },
			},
			{
				sort: {
					startedAt: 1, // TODO - is order correct?
				},
			}
		).forEach((activeRecording) => {
			recordingTimelineObjs = recordingTimelineObjs.concat(generateRecordingTimelineObjs(studio, activeRecording))
		})

		return recordingTimelineObjs
	} catch (e) {
		return []
	}
	// Timeline.remove({
	// 	siId: studioId,
	// 	recordingObject: true
	// })
}
/**
 * Fix the timeline objects, adds properties like deviceId and studioId to the timeline objects
 * @param studio
 * @param timelineObjs Array of timeline objects
 */
function processTimelineObjects(studio: Studio, timelineObjs: Array<TimelineObjGeneric>): void {
	// first, split out any grouped objects, to make the timeline shallow:
	let fixObjectChildren = (o: TimelineObjGeneric): void => {
		// Unravel children objects and put them on the (flat) timelineObjs array
		if (o.isGroup && o.children && o.children.length) {
			_.each(o.children, (child: TSR.TSRTimelineObjBase) => {
				let childFixed: TimelineObjGeneric = {
					...child,
					_id: protectString(''), // set later
					studioId: o.studioId,
					objectType: o.objectType,
					inGroup: o.id,
				}
				if (!childFixed.id) logger.error(`TimelineObj missing id attribute (child of ${o._id})`, childFixed)
				childFixed._id = getTimelineId(childFixed)
				timelineObjs.push(childFixed)

				fixObjectChildren(childFixed)
			})
			delete o.children
		}

		if (o.keyframes) {
			_.each(o.keyframes, (kf, i) => {
				kf.id = `${o.id}_keyframe_${i}`
			})
		}
	}
	_.each(timelineObjs, (o: TimelineObjGeneric) => {
		o.studioId = studio._id
		o._id = getTimelineId(o)
		fixObjectChildren(o)
	})
}
/**
 * goes through timelineObjs and forces the "now"-values to the absolute time specified
 * @param timelineObjs Array of (flat) timeline objects
 * @param now The time to set the "now":s to
 */
function setNowToTimeInObjects(timelineObjs: Array<TimelineObjGeneric>, now: Time): void {
	_.each(timelineObjs, (o) => {
		if (o.enable.start === 'now') {
			o.enable.start = now
			o.enable.setFromNow = true
		}
	})
}

function buildTimelineObjsForRundown(
	cache: CacheForRundownPlaylist,
	showStyle: ShowStyleBase,
	baselineItems: RundownBaselineObj[],
	activePlaylist: RundownPlaylist
): (TimelineObjRundown & OnGenerateTimelineObj)[] {
	let timelineObjs: Array<TimelineObjRundown & OnGenerateTimelineObj> = []
	let currentPartGroup: TimelineObjRundown | undefined
	let previousPartGroup: TimelineObjRundown | undefined

	const { currentPartInstance, nextPartInstance, previousPartInstance } = getSelectedPartInstancesFromCache(
		cache,
		activePlaylist
	)

	const currentTime = getCurrentTime()

	// let currentPieces: Array<Piece> = []

	timelineObjs.push(
		literal<TimelineObjRundown>({
			id: activePlaylist._id + '_status',
			_id: protectString(''), // set later
			studioId: protectString(''), // set later
			objectType: TimelineObjType.RUNDOWN,
			enable: { while: 1 },
			layer: 'rundown_status',
			content: {
				deviceType: TSR.DeviceType.ABSTRACT,
			},
			classes: [activePlaylist.rehearsal ? 'rundown_rehersal' : 'rundown_active'],
		})
	)

	// Fetch the nextPart first, because that affects how the currentPart will be treated
	if (activePlaylist.nextPartInstanceId) {
		// We may be at the end of a show, where there is no next part
		if (!nextPartInstance)
			throw new Meteor.Error(404, `PartInstance "${activePlaylist.nextPartInstanceId}" not found!`)
	}
	if (activePlaylist.currentPartInstanceId) {
		// We may be before the beginning of a show, and there can be no currentPart and we are waiting for the user to Take
		if (!currentPartInstance)
			throw new Meteor.Error(404, `PartInstance "${activePlaylist.currentPartInstanceId}" not found!`)
	}
	if (activePlaylist.previousPartInstanceId) {
		// We may be at the beginning of a show, where there is no previous part
		if (!previousPartInstance)
			logger.warning(`Previous PartInstance "${activePlaylist.previousPartInstanceId}" not found!`)
	}

	if (baselineItems) {
		timelineObjs = timelineObjs.concat(transformBaselineItemsIntoTimeline(baselineItems))
	}

	// Currently playing:
	if (currentPartInstance) {
		const partLastStarted = currentPartInstance.part.getLastStartedPlayback()
		const nowInPart = partLastStarted === undefined ? 0 : currentTime - partLastStarted
		const currentPieces = cache.PieceInstances.findFetch({
			partInstanceId: currentPartInstance._id,
			'piece.stoppedPlayback': { $exists: false },
			'piece.userDuration': { $exists: false },
		})
		const [currentInfinitePieces, currentNormalItems] = _.partition(
			processAndPrunePieceInstanceTimings(showStyle, currentPieces, nowInPart),
			(l) => !!l.infinite && l.piece.lifespan !== PieceLifespan.WithinPart
		)
		const currentInfinitePieceIds = _.compact(currentInfinitePieces.map((l) => l.infinite?.infinitePieceId))

		let allowTransition = false

		if (previousPartInstance) {
			allowTransition = !previousPartInstance.part.disableOutTransition

			const previousPartLastStarted = previousPartInstance.part.getLastStartedPlayback() ?? 0
			if (previousPartLastStarted) {
				const prevPartOverlapDuration = calcPartKeepaliveDuration(
					previousPartInstance.part,
					currentPartInstance.part,
					true
				)

				const previousPartGroupEnable = {
					start: previousPartLastStarted,
					end: `#${getPartGroupId(unprotectObject(currentPartInstance))}.start + ${prevPartOverlapDuration}`,
				}
				// If autonext with an overlap, keep the previous line alive for the specified overlap
				if (previousPartInstance.part.autoNext && previousPartInstance.part.autoNextOverlap) {
					previousPartGroupEnable.end = `#${getPartGroupId(
						unprotectObject(currentPartInstance)
					)}.start + ${previousPartInstance.part.autoNextOverlap || 0}`
				}
				previousPartGroup = createPartGroup(previousPartInstance, previousPartGroupEnable)
				previousPartGroup.priority = -1

				// If a Piece is infinite, and continued in the new Part, then we want to add the Piece only there to avoid id collisions
				const nowInPreviousPart = currentTime - previousPartLastStarted
				const previousContinuedPieces = processAndPrunePieceInstanceTimings(
					showStyle,
					cache.PieceInstances.findFetch({
						partInstanceId: previousPartInstance._id,
					}),
					nowInPreviousPart
				).filter((pi) => !pi.infinite || currentInfinitePieceIds.indexOf(pi.infinite.infinitePieceId) < 0)

				const groupClasses: string[] = ['previous_part']
				let prevObjs: TimelineObjRundown[] = [previousPartGroup]
				prevObjs = prevObjs.concat(
					transformPartIntoTimeline(
						activePlaylist._id,
						previousPartInstance.part._id,
						previousContinuedPieces,
						groupClasses,
						previousPartGroup,
						nowInPreviousPart,
						false,
						undefined,
						activePlaylist.holdState
					)
				)
				prevObjs = prefixAllObjectIds(prevObjs, 'previous_', true)

				timelineObjs = timelineObjs.concat(prevObjs)
			}
		}

		// fetch pieces
		// fetch the timelineobjs in pieces
		const isFollowed = nextPartInstance && currentPartInstance.part.autoNext
		const currentPartEnable = literal<TSR.Timeline.TimelineEnable>({
			duration: !isFollowed
				? undefined
				: calcPartTargetDuration(
						previousPartInstance ? previousPartInstance.part : undefined,
						currentPartInstance.part
				  ),
		})
		if (currentPartInstance.part.startedPlayback && partLastStarted) {
			// If we are recalculating the currentPart, then ensure it doesnt think it is starting now
			currentPartEnable.start = partLastStarted
		}
		currentPartGroup = createPartGroup(currentPartInstance, currentPartEnable)

		const nextPartInfinites: { [infiniteId: string]: PieceInstance | undefined } = {}
		if (currentPartInstance.part.autoNext && nextPartInstance) {
			getAllPieceInstancesFromCache(cache, nextPartInstance).forEach((piece) => {
				if (piece.infinite) {
					nextPartInfinites[unprotectString(piece.infinite.infinitePieceId)] = piece
				}
			})
		}

		const previousPartInfinites = previousPartInstance
			? normalizeArrayFunc(
					cache.PieceInstances.findFetch((p) => p.partInstanceId === previousPartInstance._id),
					(inst) => (inst.infinite ? unprotectString(inst.infinite.infinitePieceId) : '')
			  )
			: {}

		// any continued infinite lines need to skip the group, as they need a different start trigger
		for (let piece of currentInfinitePieces) {
			if (!piece.infinite) {
				// Type guard, should never be hit
				continue
			}

			const infiniteGroup = createPartGroup(currentPartInstance, {
				start: `#${currentPartGroup.id}.start`, // This gets overriden with a concrete time if the original piece is known to have already started
				duration: piece.piece.enable.duration || undefined,
			})
			infiniteGroup.id = getPartGroupId(unprotectString(piece._id)) + '_infinite' // This doesnt want to belong to a part, so force the ids
			infiniteGroup.priority = 1

			const groupClasses: string[] = ['current_part']
			// If the previousPart also contains another segment of this infinite piece, then we label our new one as such
			if (previousPartInfinites[unprotectString(piece.infinite.infinitePieceId)]) {
				groupClasses.push('continues_infinite')
			}

			let nowInParent = nowInPart
			let isAbsoluteInfinitePartGroup = false
			if (piece.piece.startedPlayback) {
				// Make the start time stick
				infiniteGroup.enable = { start: piece.piece.startedPlayback }
				nowInParent = currentTime - piece.piece.startedPlayback
				isAbsoluteInfinitePartGroup = true

				// If an absolute time has been set by a hotkey, then update the duration to be correct
				if (piece.userDuration) {
					infiniteGroup.enable.duration = piece.userDuration.end
				}
			}

			// If this infinite piece continues to the next part, and has a duration then we should respect that in case it is really close to the take
			const hasDurationOrEnd = (enable: TSR.Timeline.TimelineEnable) =>
				enable.duration !== undefined || enable.end !== undefined
			const infiniteInNextPart = nextPartInfinites[unprotectString(piece.infinite.infinitePieceId)]
			if (
				infiniteInNextPart &&
				!hasDurationOrEnd(infiniteGroup.enable) &&
				hasDurationOrEnd(infiniteInNextPart.piece.enable)
			) {
				// infiniteGroup.enable.end = infiniteInNextPart.piece.enable.end
				infiniteGroup.enable.duration = infiniteInNextPart.piece.enable.duration
			}

			// If this piece does not continue in the next part, then set it to end with the part it belongs to
			if (nextPartInstance && currentPartInstance.part.autoNext && infiniteGroup.enable.duration === undefined) {
				const nextItem = cache.PieceInstances.findFetch(
					(p) =>
						p.partInstanceId === nextPartInstance._id &&
						p.infinite &&
						p.infinite.infinitePieceId === piece.infinite?.infinitePieceId
				)
				if (!nextItem) {
					infiniteGroup.enable.end = `#${currentPartGroup.id}.end`
				}
			}

			// Still show objects flagged as 'HoldMode.EXCEPT' if this is a infinite continuation as they belong to the previous too
			const isOriginOfInfinite = piece.piece.startPartId !== currentPartInstance.part._id
			timelineObjs = timelineObjs.concat(
				infiniteGroup,
				transformPartIntoTimeline(
					activePlaylist._id,
					currentPartInstance.part._id,
					[piece],
					groupClasses,
					infiniteGroup,
					nowInParent,
					isAbsoluteInfinitePartGroup,
					undefined,
					activePlaylist.holdState,
					isOriginOfInfinite
				)
			)
		}

		const groupClasses: string[] = ['current_part']
		const transProps: TransformTransitionProps = {
			allowed: allowTransition,
			preroll: currentPartInstance.part.prerollDuration,
			transitionPreroll: currentPartInstance.part.transitionPrerollDuration,
			transitionKeepalive: currentPartInstance.part.transitionKeepaliveDuration,
		}
		timelineObjs.push(
			currentPartGroup,
			createPartGroupFirstObject(activePlaylist._id, currentPartInstance, currentPartGroup, previousPartInstance),
			...transformPartIntoTimeline(
				activePlaylist._id,
				currentPartInstance.part._id,
				currentNormalItems,
				groupClasses,
				currentPartGroup,
				nowInPart,
				false,
				transProps,
				activePlaylist.holdState
			)
		)

		// only add the next objects into the timeline if the next segment is autoNext
		if (nextPartInstance && currentPartInstance.part.autoNext) {
			// console.log('This part will autonext')
			let nextPartGroup = createPartGroup(nextPartInstance, {})
			if (currentPartGroup) {
				const overlapDuration = calcPartOverlapDuration(currentPartInstance.part, nextPartInstance.part)

				nextPartGroup.enable = {
					start: `#${currentPartGroup.id}.end - ${overlapDuration}`,
					duration: nextPartGroup.enable.duration,
				}
			}

			const nextPieceInstances = processAndPrunePieceInstanceTimings(
				showStyle,
				cache.PieceInstances.findFetch({ partInstanceId: nextPartInstance._id }),
				0
			).filter((i) => !i.infinite || currentInfinitePieceIds.indexOf(i.infinite.infinitePieceId) === -1)

			const groupClasses: string[] = ['next_part']
			const transProps: TransformTransitionProps = {
				allowed: currentPartInstance && !currentPartInstance.part.disableOutTransition,
				preroll: nextPartInstance.part.prerollDuration,
				transitionPreroll: nextPartInstance.part.transitionPrerollDuration,
				transitionKeepalive: nextPartInstance.part.transitionKeepaliveDuration,
			}
			timelineObjs.push(
				nextPartGroup,
				createPartGroupFirstObject(activePlaylist._id, nextPartInstance, nextPartGroup, currentPartInstance),
				...transformPartIntoTimeline(
					activePlaylist._id,
					nextPartInstance.part._id,
					nextPieceInstances,
					groupClasses,
					nextPartGroup,
					0,
					false,
					transProps
				)
			)
		}
	}

	if (!nextPartInstance && !currentPartInstance) {
		// maybe at the end of the show
		logger.info(`No next part and no current part set on RundownPlaylist "${activePlaylist._id}".`)
	}

	return timelineObjs
}
function createPartGroup(
	partInstance: PartInstance,
	enable: TSR.Timeline.TimelineEnable
): TimelineObjGroupPart & TimelineObjRundown {
	if (!enable.start) {
		// TODO - is this loose enough?
		enable.start = 'now'
	}
	let partGrp = literal<TimelineObjGroupPart>({
		id: getPartGroupId(unprotectObject(partInstance)),
		_id: protectString(''), // set later
		studioId: protectString(''), // set later
		objectType: TimelineObjType.RUNDOWN,
		enable: enable,
		priority: 5,
		layer: '', // These should coexist
		content: {
			deviceType: TSR.DeviceType.ABSTRACT,
			type: TimelineContentTypeOther.GROUP,
		},
		children: [],
		isGroup: true,
		isPartGroup: true,
	})

	return partGrp
}
function createPartGroupFirstObject(
	playlistId: RundownPlaylistId,
	partInstance: PartInstance,
	partGroup: TimelineObjRundown,
	previousPart?: PartInstance
): TimelineObjPartAbstract {
	return literal<TimelineObjPartAbstract>({
		id: getPartFirstObjectId(unprotectObject(partInstance)),
		_id: protectString(''), // set later
		studioId: protectString(''), // set later
		objectType: TimelineObjType.RUNDOWN,
		enable: { start: 0 },
		layer: 'group_first_object',
		content: {
			deviceType: TSR.DeviceType.ABSTRACT,
			type: 'callback',
			// Will cause the playout-gateway to run a callback, when the object starts playing:
			callBack: 'partPlaybackStarted',
			callBackData: {
				rundownPlaylistId: playlistId,
				partInstanceId: partInstance._id,
			},
			callBackStopped: 'partPlaybackStopped', // Will cause a callback to be called, when the object stops playing:
		},
		inGroup: partGroup.id,
		classes: (partInstance.part.classes || []).concat(previousPart ? previousPart.part.classesForNext || [] : []),
	})
}

function transformBaselineItemsIntoTimeline(objs: RundownBaselineObj[]): Array<TimelineObjRundown> {
	let timelineObjs: Array<TimelineObjRundown> = []
	_.each(objs, (obj: RundownBaselineObj) => {
		// the baseline objects are layed out without any grouping
		_.each(obj.objects, (o: TimelineObjGeneric) => {
			timelineObjs.push(
				extendMandadory<TimelineObjGeneric, TimelineObjRundown>(o, {
					objectType: TimelineObjType.RUNDOWN,
				})
			)
		})
	})
	return timelineObjs
}

interface TransformTransitionProps {
	allowed: boolean
	preroll?: number
	transitionPreroll?: number | null
	transitionKeepalive?: number | null
}

function hasPieceInstanceDefinitelyEnded(
	pieceInstance: DeepReadonly<PieceInstanceWithTimings>,
	nowInPart: number
): boolean {
	if (nowInPart <= 0) return false

	let relativeEnd: number | undefined
	if (typeof pieceInstance.resolvedEndCap === 'number') {
		relativeEnd = pieceInstance.resolvedEndCap
	}
	if (pieceInstance.userDuration) {
		relativeEnd =
			relativeEnd === undefined
				? pieceInstance.userDuration.end
				: Math.min(relativeEnd, pieceInstance.userDuration.end)
	}
	if (typeof pieceInstance.piece.enable.start === 'number' && pieceInstance.piece.enable.duration !== undefined) {
		const candidateEnd = pieceInstance.piece.enable.start + pieceInstance.piece.enable.duration
		relativeEnd = relativeEnd === undefined ? candidateEnd : Math.min(relativeEnd, candidateEnd)
	}

	return relativeEnd !== undefined && relativeEnd + DEFINITELY_ENDED_FUTURE_DURATION < nowInPart
}

function transformPartIntoTimeline(
	playlistId: RundownPlaylistId,
	partId: PartId,
	pieceInstances: DeepReadonly<PieceInstanceWithTimings>[],
	firstObjClasses: string[],
	partGroup: TimelineObjRundown,
	nowInPart: number,
	isAbsoluteInfinitePartGroup: boolean,
	transitionProps?: TransformTransitionProps,
	holdState?: RundownHoldState,
	showHoldExcept?: boolean
): Array<TimelineObjRundown & OnGenerateTimelineObj> {
	let timelineObjs: Array<TimelineObjRundown & OnGenerateTimelineObj> = []

	const isHold = holdState === RundownHoldState.ACTIVE
	const allowTransition =
		transitionProps && transitionProps.allowed && !isHold && holdState !== RundownHoldState.COMPLETE
	const transition: DeepReadonly<PieceInstanceWithTimings> | undefined = allowTransition
		? pieceInstances.find((i) => !!i.piece.isTransition)
		: undefined
	const transitionPieceDelay = transitionProps
		? Math.max(0, (transitionProps.preroll || 0) - (transitionProps.transitionPreroll || 0))
		: 0
	const transitionContentsDelay = transitionProps
		? (transitionProps.transitionPreroll || 0) - (transitionProps.preroll || 0)
		: 0

	for (const pieceInstance of pieceInstances) {
		if (pieceInstance.disabled) continue
		if (pieceInstance.piece.isTransition && (!allowTransition || isHold)) {
			continue
		}

		const hasDefinitelyEnded = hasPieceInstanceDefinitelyEnded(pieceInstance, nowInPart)

		const isInfiniteContinuation = pieceInstance.infinite && pieceInstance.piece.startPartId !== partId

		const pieceEnable: TSR.Timeline.TimelineEnable = {}
		if (pieceInstance.userDuration) {
			pieceEnable.end = pieceInstance.userDuration.end
		} else {
			pieceEnable.duration = pieceInstance.piece.enable.duration
		}

		if (isAbsoluteInfinitePartGroup) {
			pieceEnable.start = 0
		} else {
			pieceEnable.start = pieceInstance.piece.enable.start

			if (pieceEnable.start === 0 && !isInfiniteContinuation) {
				// If timed absolute and there is a transition delay, then apply delay
				if (
					!pieceInstance.piece.isTransition &&
					allowTransition &&
					transition &&
					!pieceInstance.adLibSourceId
				) {
					const transitionContentsDelayStr =
						transitionContentsDelay < 0 ? `- ${-transitionContentsDelay}` : `+ ${transitionContentsDelay}`
					pieceEnable.start = `#${getPieceGroupId(
						unprotectString(transition._id)
					)}.start ${transitionContentsDelayStr}`
				} else if (pieceInstance.piece.isTransition && transitionPieceDelay) {
					pieceEnable.start = Math.max(0, transitionPieceDelay)
				}
			}
		}

		// create a piece group for the pieces and then place all of them there
		const { pieceGroup, capObjs } = createPieceGroupAndCap(pieceInstance, partGroup, pieceEnable)
		timelineObjs.push(pieceGroup)
		timelineObjs.push(...capObjs)

		if (!pieceInstance.piece.virtual && pieceInstance.piece.content?.timelineObjects && !hasDefinitelyEnded) {
			timelineObjs.push(createPieceGroupFirstObject(playlistId, pieceInstance, pieceGroup, firstObjClasses))

			for (const o of pieceInstance.piece.content.timelineObjects) {
				if (o.holdMode) {
					if (isHold && !showHoldExcept && o.holdMode === TimelineObjHoldMode.EXCEPT) {
						continue
					}
					if (!isHold && o.holdMode === TimelineObjHoldMode.ONLY) {
						continue
					}
				}

				timelineObjs.push({
					...clone<TimelineObjectCoreExt>(o),
					_id: protectString(''), // set later
					studioId: protectString(''), // set later
					inGroup: pieceGroup.id,
					objectType: TimelineObjType.RUNDOWN,
					pieceInstanceId: unprotectString(pieceInstance._id),
					infinitePieceId: unprotectString(pieceInstance.infinite?.infinitePieceId),
				})
			}
		}
	}
	return timelineObjs
}

function calcPartKeepaliveDuration(fromPart: Part, toPart: Part, relativeToFrom: boolean): number {
	const allowTransition: boolean = !fromPart.disableOutTransition
	if (!allowTransition) {
		return fromPart.autoNextOverlap || 0
	}

	if (relativeToFrom) {
		// TODO remove
		if (toPart.transitionKeepaliveDuration === undefined || toPart.transitionKeepaliveDuration === null) {
			return toPart.prerollDuration || 0
		}

		const transPieceDelay = Math.max(0, (toPart.prerollDuration || 0) - (toPart.transitionPrerollDuration || 0))
		return transPieceDelay + (toPart.transitionKeepaliveDuration || 0)
	}

	// if (toPart.transitionKeepaliveDuration === undefined || toPart.transitionKeepaliveDuration === null) {
	// 	return (fromPart.autoNextOverlap || 0)
	// }

	return 0
}
function calcPartTargetDuration(prevPart: Part | undefined, currentPart: Part): number {
	if (currentPart.expectedDuration === undefined) {
		return 0
	}

	// This is a horrible hack, to compensate for the expectedDuration mangling in the blueprints which is
	// needed to get the show runtime to be correct. This just inverts that mangling before running as 'intended'
	const maxPreroll = Math.max(
		currentPart.transitionPrerollDuration ? currentPart.transitionPrerollDuration : 0,
		currentPart.prerollDuration || 0
	)
	const maxKeepalive = Math.max(
		currentPart.transitionKeepaliveDuration ? currentPart.transitionKeepaliveDuration : 0,
		currentPart.prerollDuration || 0
	)
	const lengthAdjustment = maxPreroll - maxKeepalive
	const rawExpectedDuration =
		(currentPart.expectedDuration || 0) - lengthAdjustment + (currentPart.autoNextOverlap || 0)

	if (!prevPart || prevPart.disableOutTransition) {
		return rawExpectedDuration + (currentPart.prerollDuration || 0)
	}

	let prerollDuration = currentPart.transitionPrerollDuration || currentPart.prerollDuration || 0
	return rawExpectedDuration + prerollDuration
}
function calcPartOverlapDuration(fromPart: Part, toPart: Part): number {
	const allowTransition: boolean = !fromPart.disableOutTransition
	let overlapDuration: number = toPart.prerollDuration || 0
	if (allowTransition && toPart.transitionPrerollDuration) {
		overlapDuration = calcPartKeepaliveDuration(fromPart, toPart, true)
	}

	if (fromPart.autoNext) {
		overlapDuration += fromPart.autoNextOverlap || 0
	}

	return overlapDuration
}
