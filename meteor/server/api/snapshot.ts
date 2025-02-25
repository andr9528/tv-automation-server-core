import * as Path from 'path'
import { Meteor } from 'meteor/meteor'
import * as _ from 'underscore'
import { ServerResponse, IncomingMessage } from 'http'
import { check, Match } from '../../lib/check'
import { Studio, Studios, StudioId } from '../../lib/collections/Studios'
import {
	Snapshots,
	DeprecatedSnapshotRundown,
	SnapshotType,
	SnapshotSystem,
	SnapshotDebug,
	SnapshotBase,
	SnapshotRundownPlaylist,
	SnapshotId,
} from '../../lib/collections/Snapshots'
import { Rundowns, DBRundown, RundownId } from '../../lib/collections/Rundowns'
import { UserActionsLog, UserActionsLogItem } from '../../lib/collections/UserActionsLog'
import { Segments, Segment, SegmentId } from '../../lib/collections/Segments'
import { Part, Parts, PartId } from '../../lib/collections/Parts'
import { Pieces, Piece, PieceId } from '../../lib/collections/Pieces'
import { AdLibPieces, AdLibPiece } from '../../lib/collections/AdLibPieces'
import { MediaObjects, MediaObject } from '../../lib/collections/MediaObjects'
import {
	getCurrentTime,
	Time,
	formatDateTime,
	fixValidPath,
	protectString,
	getRandomId,
	unprotectString,
	ProtectedString,
	protectStringArray,
	assertNever,
	stringifyError,
} from '../../lib/lib'
import { ShowStyleBases, ShowStyleBase, ShowStyleBaseId } from '../../lib/collections/ShowStyleBases'
import { PeripheralDevices, PeripheralDevice, PeripheralDeviceId } from '../../lib/collections/PeripheralDevices'
import { logger } from '../logging'
import { Timeline, TimelineComplete } from '../../lib/collections/Timeline'
import { PeripheralDeviceCommands, PeripheralDeviceCommand } from '../../lib/collections/PeripheralDeviceCommands'
import { PeripheralDeviceAPI } from '../../lib/api/peripheralDevice'
import { registerClassToMeteorMethods } from '../methods'
import { NewSnapshotAPI, SnapshotAPIMethods } from '../../lib/api/shapshot'
import { getCoreSystem, ICoreSystem, CoreSystem, parseVersion } from '../../lib/collections/CoreSystem'
import { CURRENT_SYSTEM_VERSION } from '../migration/currentSystemVersion'
import { isVersionSupported } from '../migration/databaseMigration'
import { ShowStyleVariant, ShowStyleVariants } from '../../lib/collections/ShowStyleVariants'
import { Blueprints, Blueprint, BlueprintId } from '../../lib/collections/Blueprints'
import { IngestRundown, VTContent } from '@sofie-automation/blueprints-integration'
import { MongoQuery } from '../../lib/typings/meteor'
import { ExpectedMediaItem, ExpectedMediaItems } from '../../lib/collections/ExpectedMediaItems'
import {
	ExpectedPackageDB,
	ExpectedPackageDBType,
	ExpectedPackages,
	getExpectedPackageId,
} from '../../lib/collections/ExpectedPackages'
import { IngestDataCacheObj, IngestDataCache } from '../../lib/collections/IngestDataCache'
import { importIngestRundown } from './ingest/http'
import { RundownBaselineObj, RundownBaselineObjs } from '../../lib/collections/RundownBaselineObjs'
import { RundownBaselineAdLibItem, RundownBaselineAdLibPieces } from '../../lib/collections/RundownBaselineAdLibPieces'
import { RundownPlaylists, DBRundownPlaylist, RundownPlaylistId } from '../../lib/collections/RundownPlaylists'
import { RundownLayouts, RundownLayoutBase } from '../../lib/collections/RundownLayouts'
import { DBTriggeredActions, TriggeredActions } from '../../lib/collections/TriggeredActions'
import { ExpectedPlayoutItem, ExpectedPlayoutItems } from '../../lib/collections/ExpectedPlayoutItems'
import { PartInstances, PartInstance, PartInstanceId } from '../../lib/collections/PartInstances'
import { PieceInstance, PieceInstances } from '../../lib/collections/PieceInstances'
import { makePlaylistFromRundown_1_0_0 } from '../migration/deprecatedDataTypes/1_0_1'
import { OrganizationId } from '../../lib/collections/Organization'
import { Settings } from '../../lib/Settings'
import { MethodContext, MethodContextAPI } from '../../lib/api/methods'
import { Credentials, isResolvedCredentials } from '../security/lib/credentials'
import { BasicAccessContext, OrganizationContentWriteAccess } from '../security/organization'
import { StudioContentWriteAccess, StudioReadAccess } from '../security/studio'
import { SystemWriteAccess } from '../security/system'
import { PickerPOST, PickerGET } from './http'
import { getPartId, getSegmentId } from './ingest/lib'
import { Piece as Piece_1_11_0 } from '../migration/deprecatedDataTypes/1_11_0'
import { AdLibActions, AdLibAction, AdLibActionId } from '../../lib/collections/AdLibActions'
import {
	RundownBaselineAdLibActions,
	RundownBaselineAdLibAction,
	RundownBaselineAdLibActionId,
} from '../../lib/collections/RundownBaselineAdLibActions'
import { migrateConfigToBlueprintConfigOnObject } from '../migration/1_12_0'
import { saveIntoDb, sumChanges } from '../lib/database'
import * as fs from 'fs'
import {
	ExpectedPackageWorkStatus,
	ExpectedPackageWorkStatuses,
} from '../../lib/collections/ExpectedPackageWorkStatuses'
import {
	PackageContainerPackageStatusDB,
	PackageContainerPackageStatuses,
} from '../../lib/collections/PackageContainerPackageStatus'
import { PackageInfoDB, PackageInfos } from '../../lib/collections/PackageInfos'
import { checkStudioExists } from '../../lib/collections/optimizations'

interface DeprecatedRundownSnapshot {
	// Old, from the times before rundownPlaylists
	version: string
	rundownId: RundownId
	snapshot: DeprecatedSnapshotRundown
	rundown: DBRundown
	ingestData: Array<IngestDataCacheObj>
	userActions: Array<UserActionsLogItem>
	baselineObjs: Array<RundownBaselineObj>
	baselineAdlibs: Array<RundownBaselineAdLibItem>
	segments: Array<Segment>
	parts: Array<Part>
	pieces: Array<Piece>
	adLibPieces: Array<AdLibPiece>
	mediaObjects: Array<MediaObject>
	expectedMediaItems: Array<ExpectedMediaItem>
	expectedPlayoutItems: Array<ExpectedPlayoutItem>
}

interface RundownPlaylistSnapshot {
	version: string
	playlistId: RundownPlaylistId
	snapshot: SnapshotRundownPlaylist
	playlist: DBRundownPlaylist
	rundowns: Array<DBRundown>
	ingestData: Array<IngestDataCacheObj>
	userActions: Array<UserActionsLogItem>
	baselineObjs: Array<RundownBaselineObj>
	baselineAdlibs: Array<RundownBaselineAdLibItem>
	segments: Array<Segment>
	parts: Array<Part>
	partInstances: Array<PartInstance>
	pieces: Array<Piece>
	pieceInstances: Array<PieceInstance>
	adLibPieces: Array<AdLibPiece>
	adLibActions: Array<AdLibAction>
	baselineAdLibActions: Array<RundownBaselineAdLibAction>
	mediaObjects: Array<MediaObject>
	expectedMediaItems: Array<ExpectedMediaItem>
	expectedPlayoutItems: Array<ExpectedPlayoutItem>
	expectedPackages: Array<ExpectedPackageDB>

	expectedPackageWorkStatuses: Array<ExpectedPackageWorkStatus>
	packageContainerPackageStatuses: Array<PackageContainerPackageStatusDB>
	packageInfos: Array<PackageInfoDB>
}
interface SystemSnapshot {
	version: string
	studioId: StudioId | null
	snapshot: SnapshotSystem
	studios: Array<Studio>
	showStyleBases: Array<ShowStyleBase>
	showStyleVariants: Array<ShowStyleVariant>
	blueprints?: Array<Blueprint> // optional, to be backwards compatible
	rundownLayouts?: Array<RundownLayoutBase> // optional, to be backwards compatible
	triggeredActions?: Array<DBTriggeredActions> // optional, to be backwards compatible
	devices: Array<PeripheralDevice>
	deviceCommands: Array<PeripheralDeviceCommand>
	coreSystem: ICoreSystem
}
interface DebugSnapshot {
	version: string
	studioId?: StudioId
	snapshot: SnapshotDebug
	system: SystemSnapshot
	activeRundownPlaylists: Array<RundownPlaylistSnapshot>
	timeline: TimelineComplete[]
	userActionLog: Array<UserActionsLogItem>
	deviceSnaphots: Array<DeviceSnapshot>
}
interface DeviceSnapshot {
	deviceId: PeripheralDeviceId
	created: Time
	replyTime: Time
	content: any
}
type AnySnapshot = RundownPlaylistSnapshot | SystemSnapshot | DebugSnapshot | DeprecatedRundownSnapshot

/**
 * Create a snapshot of all items related to a RundownPlaylist
 * @param playlistId
 */
async function createRundownPlaylistSnapshot(
	playlistId: RundownPlaylistId,
	organizationId: OrganizationId | null,
	full: boolean = false
): Promise<RundownPlaylistSnapshot> {
	const snapshotId: SnapshotId = getRandomId()
	logger.info(
		`Generating ${full ? 'full ' : ''}RundownPlaylist snapshot "${snapshotId}" for RundownPlaylist "${playlistId}"`
	)

	const playlist = await RundownPlaylists.findOneAsync(playlistId)
	if (!playlist) throw new Meteor.Error(404, `Playlist "${playlistId}" not found`)
	const rundowns = await Rundowns.findFetchAsync({ playlistId: playlist._id })
	const rundownIds = rundowns.map((i) => i._id)
	const ingestData = await IngestDataCache.findFetchAsync(
		{ rundownId: { $in: rundownIds } },
		{ sort: { modified: -1 } }
	) // @todo: check sorting order
	const userActions = await UserActionsLog.findFetchAsync({
		args: {
			$regex:
				`.*(` +
				rundownIds
					.concat(playlistId as any)
					.map((i) => `"${i}"`)
					.join('|') +
				`).*`,
		},
	})

	const segments = await Segments.findFetchAsync({ rundownId: { $in: rundownIds } })
	const parts = await Parts.findFetchAsync({ rundownId: { $in: rundownIds } })
	const validTime = getCurrentTime() - 1000 * 3600 * 24 // 24 hours ago
	const partInstances = await PartInstances.findFetchAsync(
		full
			? { rundownId: { $in: rundownIds } }
			: {
					rundownId: { $in: rundownIds },
					$or: [{ 'timings.takeOut': { $gte: validTime }, reset: true }, { reset: { $ne: true } }],
			  }
	)
	const partInstanceIds = partInstances.map((p) => p._id)
	const pieces = await Pieces.findFetchAsync({ startRundownId: { $in: rundownIds } })
	const pieceInstances = await PieceInstances.findFetchAsync(
		full
			? { rundownId: { $in: rundownIds } }
			: {
					rundownId: { $in: rundownIds },
					$or: [{ partInstanceId: { $in: partInstanceIds } }, { reset: { $ne: true } }],
			  }
	)
	const adLibPieces = await AdLibPieces.findFetchAsync({ rundownId: { $in: rundownIds } })
	const baselineAdlibs = await RundownBaselineAdLibPieces.findFetchAsync({ rundownId: { $in: rundownIds } })
	const adLibActions = await AdLibActions.findFetchAsync({ rundownId: { $in: rundownIds } })
	const baselineAdLibActions = await RundownBaselineAdLibActions.findFetchAsync({ rundownId: { $in: rundownIds } })
	const mediaObjectIds: Array<string> = [
		..._.compact(pieces.map((piece) => (piece.content as VTContent | undefined)?.fileName)),
		..._.compact(adLibPieces.map((adLibPiece) => (adLibPiece.content as VTContent | undefined)?.fileName)),
		..._.compact(baselineAdlibs.map((adLibPiece) => (adLibPiece.content as VTContent | undefined)?.fileName)),
	]
	const mediaObjects = await MediaObjects.findFetchAsync({
		studioId: playlist.studioId,
		mediaId: { $in: mediaObjectIds },
	})
	const expectedMediaItems = await ExpectedMediaItems.findFetchAsync({ partId: { $in: parts.map((i) => i._id) } })
	const expectedPlayoutItems = await ExpectedPlayoutItems.findFetchAsync({ rundownId: { $in: rundownIds } })
	const expectedPackages = await ExpectedPackages.findFetchAsync({ rundownId: { $in: rundownIds } })
	const baselineObjs = await RundownBaselineObjs.findFetchAsync({ rundownId: { $in: rundownIds } })

	const expectedPackageWorkStatuses = await ExpectedPackageWorkStatuses.findFetchAsync({
		studioId: playlist.studioId,
	})
	const packageContainerPackageStatuses = await PackageContainerPackageStatuses.findFetchAsync({
		studioId: playlist.studioId,
	})
	const packageInfos = await PackageInfos.findFetchAsync({
		studioId: playlist.studioId,
	})

	logger.info(`Snapshot generation done`)
	return {
		version: CURRENT_SYSTEM_VERSION,
		playlistId,
		snapshot: {
			_id: snapshotId,
			organizationId: organizationId,
			created: getCurrentTime(),
			type: SnapshotType.RUNDOWNPLAYLIST,
			playlistId,
			studioId: playlist.studioId,
			name: `Rundown_${playlist.name}_${playlist._id}_${formatDateTime(getCurrentTime())}`,
			version: CURRENT_SYSTEM_VERSION,
		},
		playlist,
		rundowns,
		ingestData,
		userActions,
		baselineObjs,
		baselineAdlibs,
		segments,
		parts,
		partInstances,
		pieces,
		pieceInstances,
		adLibPieces,
		adLibActions,
		baselineAdLibActions,
		mediaObjects,
		expectedMediaItems,
		expectedPlayoutItems,
		expectedPackages,
		expectedPackageWorkStatuses,
		packageContainerPackageStatuses,
		packageInfos,
	}
}

/**
 * Create a snapshot of all items related to the base system (all settings),
 * that means all studios, showstyles, peripheralDevices etc
 * If studioId is provided, only return items related to that studio
 * @param studioId (Optional) Only generate for a certain studio
 */
async function createSystemSnapshot(
	studioId: StudioId | null,
	organizationId: OrganizationId | null
): Promise<SystemSnapshot> {
	const snapshotId: SnapshotId = getRandomId()
	logger.info(`Generating System snapshot "${snapshotId}"` + (studioId ? `for studio "${studioId}"` : ''))

	const coreSystem = getCoreSystem()
	if (!coreSystem) throw new Meteor.Error(500, `coreSystem not set up`)

	if (Settings.enableUserAccounts && !organizationId)
		throw new Meteor.Error(500, 'Not able to create a systemSnaphost without organizationId')

	let queryStudio: MongoQuery<Studio> = {}
	let queryShowStyleBases: MongoQuery<ShowStyleBase> = {}
	let queryShowStyleVariants: MongoQuery<ShowStyleVariant> = {}
	let queryRundownLayouts: MongoQuery<RundownLayoutBase> = {}
	let queryTriggeredActions: MongoQuery<DBTriggeredActions> = {}
	let queryDevices: MongoQuery<PeripheralDevice> = {}
	let queryBlueprints: MongoQuery<Blueprint> = {}

	if (studioId) queryStudio = { _id: studioId }
	else if (organizationId) queryStudio = { organizationId: organizationId }
	const studios = await Studios.findFetchAsync(queryStudio)

	if (studioId) {
		const ids: ShowStyleBaseId[] = []
		for (const studio of studios) {
			ids.push(...studio.supportedShowStyleBase)
		}
		queryShowStyleBases = {
			_id: { $in: ids },
		}
	} else if (organizationId) {
		queryShowStyleBases = { organizationId: organizationId }
	}
	const showStyleBases = await ShowStyleBases.findFetchAsync(queryShowStyleBases)

	const showStyleBaseIds = showStyleBases.map((s) => s._id)

	queryShowStyleVariants = { showStyleBaseId: { $in: showStyleBaseIds } }
	queryRundownLayouts = { showStyleBaseId: { $in: showStyleBaseIds } }
	queryTriggeredActions = { showStyleBaseIds: { $in: [null, ...showStyleBaseIds] } }

	if (studioId) queryDevices = { studioId: studioId }
	else if (organizationId) queryDevices = { organizationId: organizationId }

	const [showStyleVariants, rundownLayouts, devices, triggeredActions] = await Promise.all([
		ShowStyleVariants.findFetchAsync(queryShowStyleVariants),
		RundownLayouts.findFetchAsync(queryRundownLayouts),
		PeripheralDevices.findFetchAsync(queryDevices),
		TriggeredActions.findFetchAsync(queryTriggeredActions),
	])

	if (studioId) {
		const blueprintIds: BlueprintId[] = []
		for (const showStyleBase of showStyleBases) {
			blueprintIds.push(showStyleBase.blueprintId)
		}
		queryBlueprints = {
			_id: { $in: blueprintIds },
		}
	} else if (organizationId) {
		queryBlueprints = {
			organizationId: organizationId,
		}
	}
	const blueprints = await Blueprints.findFetchAsync(queryBlueprints)

	const deviceCommands = await PeripheralDeviceCommands.findFetchAsync({
		deviceId: { $in: devices.map((device) => device._id) },
	})

	logger.info(`Snapshot generation done`)
	return {
		version: CURRENT_SYSTEM_VERSION,
		studioId: studioId,
		snapshot: {
			_id: snapshotId,
			organizationId: organizationId,
			type: SnapshotType.SYSTEM,
			created: getCurrentTime(),
			name: `System` + (studioId ? `_${studioId}` : '') + `_${formatDateTime(getCurrentTime())}`,
			version: CURRENT_SYSTEM_VERSION,
		},
		studios,
		showStyleBases,
		showStyleVariants,
		blueprints,
		rundownLayouts,
		triggeredActions,
		devices,
		coreSystem,
		deviceCommands: deviceCommands,
	}
}

/**
 * Create a snapshot of active rundowns related to a studio and all related data, for debug purposes
 * @param studioId
 */
async function createDebugSnapshot(studioId: StudioId, organizationId: OrganizationId | null): Promise<DebugSnapshot> {
	const snapshotId: SnapshotId = getRandomId()
	logger.info(`Generating Debug snapshot "${snapshotId}" for studio "${studioId}"`)

	const studio = await Studios.findOneAsync(studioId)
	if (!studio) throw new Meteor.Error(404, `Studio ${studioId} not found`)

	const systemSnapshot = await createSystemSnapshot(studioId, organizationId)

	const activePlaylists = await RundownPlaylists.findFetchAsync({
		studioId: studio._id,
		activationId: { $exists: true },
	})

	const activePlaylistSnapshots = await Promise.all(
		activePlaylists.map(async (playlist) => {
			return createRundownPlaylistSnapshot(playlist._id, organizationId, true)
		})
	)

	const timeline = await Timeline.findFetchAsync({})
	const userActionLogLatest = await UserActionsLog.findFetchAsync({
		timestamp: {
			$gt: getCurrentTime() - 1000 * 3600 * 3, // latest 3 hours
		},
	})

	// Also fetch debugInfo from devices:
	const deviceSnaphots: Array<DeviceSnapshot> = _.compact(
		await Promise.all(
			systemSnapshot.devices.map(async (device) => {
				if (device.connected && device.subType === PeripheralDeviceAPI.SUBTYPE_PROCESS) {
					const startTime = getCurrentTime()

					// defer to another fiber
					const deviceSnapshot = await PeripheralDeviceAPI.executeFunction(device._id, 'getSnapshot')

					logger.info('Got snapshot from device "' + device._id + '"')
					return {
						deviceId: device._id,
						created: startTime,
						replyTime: getCurrentTime(),
						content: deviceSnapshot,
					}
				}
				return null
			})
		)
	)

	logger.info(`Snapshot generation done`)
	return {
		version: CURRENT_SYSTEM_VERSION,
		studioId: studioId,
		snapshot: {
			_id: snapshotId,
			organizationId: organizationId,
			type: SnapshotType.DEBUG,
			created: getCurrentTime(),
			name: `Debug_${studioId}_${formatDateTime(getCurrentTime())}`,
			version: CURRENT_SYSTEM_VERSION,
		},
		system: systemSnapshot,
		activeRundownPlaylists: activePlaylistSnapshots,
		timeline: timeline,
		userActionLog: userActionLogLatest,
		deviceSnaphots: deviceSnaphots,
	}
}

// Setup endpoints:
async function handleResponse(response: ServerResponse, snapshotFcn: () => Promise<{ snapshot: SnapshotBase }>) {
	try {
		const s: any = await snapshotFcn()
		response.setHeader('Content-Type', 'application/json')
		response.setHeader(
			'Content-Disposition',
			`attachment; filename*=UTF-8''${encodeURIComponent(s.snapshot.name)}.json`
		)

		const content = _.isString(s) ? s : JSON.stringify(s, null, 4)
		response.statusCode = 200
		response.end(content)
	} catch (e) {
		response.setHeader('Content-Type', 'text/plain')
		response.statusCode = e instanceof Meteor.Error && typeof e.error === 'number' ? e.error : 500
		response.end('Error: ' + stringifyError(e))

		if (response.statusCode !== 404) {
			logger.error(stringifyError(e))
		}
	}
}
async function storeSnaphot(
	snapshot: { snapshot: SnapshotBase },
	organizationId: OrganizationId | null,
	comment: string
): Promise<SnapshotId> {
	const system = getCoreSystem()
	if (!system) throw new Meteor.Error(500, `CoreSystem not found!`)
	if (!system.storePath) throw new Meteor.Error(500, `CoreSystem.storePath not set!`)

	const fileName = fixValidPath(snapshot.snapshot.name) + '.json'
	const filePath = Path.join(system.storePath, fileName)

	const str = JSON.stringify(snapshot)

	// Store to the persistant file storage
	logger.info(`Save snapshot file ${filePath}`)
	if (!Meteor.isTest) {
		// If we're running in a unit-test, don't write to disk
		await fs.promises.writeFile(filePath, str)
	}

	const id = await Snapshots.insertAsync({
		_id: protectString(fileName),
		organizationId: organizationId,
		fileName: fileName,
		type: snapshot.snapshot.type,
		created: snapshot.snapshot.created,
		name: snapshot.snapshot.name,
		description: snapshot.snapshot.description,
		version: CURRENT_SYSTEM_VERSION,
		comment: comment,
	})

	return id
}
async function retreiveSnapshot(snapshotId: SnapshotId, cred0: Credentials): Promise<AnySnapshot> {
	const snapshot = Snapshots.findOne(snapshotId)
	if (!snapshot) throw new Meteor.Error(404, `Snapshot not found!`)

	if (Settings.enableUserAccounts) {
		if (snapshot.type === SnapshotType.RUNDOWNPLAYLIST) {
			if (!snapshot.studioId)
				throw new Meteor.Error(500, `Snapshot is of type "${snapshot.type}" but hase no studioId`)
			StudioContentWriteAccess.dataFromSnapshot(cred0, snapshot.studioId)
		} else if (snapshot.type === SnapshotType.RUNDOWN) {
			if (!snapshot.studioId)
				throw new Meteor.Error(500, `Snapshot is of type "${snapshot.type}" but hase no studioId`)
			StudioContentWriteAccess.dataFromSnapshot(cred0, snapshot.studioId)
		} else if (snapshot.type === SnapshotType.SYSTEM) {
			if (!snapshot.organizationId)
				throw new Meteor.Error(500, `Snapshot is of type "${snapshot.type}" but has no organizationId`)
			OrganizationContentWriteAccess.dataFromSnapshot(cred0, snapshot.organizationId)
		} else {
			SystemWriteAccess.coreSystem(cred0)
		}
	}

	const system = getCoreSystem()
	if (!system) throw new Meteor.Error(500, `CoreSystem not found!`)
	if (!system.storePath) throw new Meteor.Error(500, `CoreSystem.storePath not set!`)

	const filePath = Path.join(system.storePath, snapshot.fileName)

	const dataStr = !Meteor.isTest // If we're running in a unit-test, don't access files
		? await fs.promises.readFile(filePath, { encoding: 'utf8' })
		: ''

	const readSnapshot = JSON.parse(dataStr)

	return readSnapshot
}
function restoreFromSnapshot(snapshot: AnySnapshot) {
	// Determine what kind of snapshot

	if (!_.isObject(snapshot)) throw new Meteor.Error(500, `Restore input data is not an object`)
	// First, some special (debugging) cases:
	// @ts-ignore is's not really a snapshot here:
	if (snapshot.externalId && snapshot.segments && snapshot.type === 'mos') {
		// Special: Not a snapshot, but a datadump of a MOS rundown
		const studioId: StudioId = Meteor.settings.manualSnapshotIngestStudioId || 'studio0'
		const studioExists = checkStudioExists(studioId)
		if (studioExists) {
			importIngestRundown(studioId, snapshot as unknown as IngestRundown)
			return
		}
		throw new Meteor.Error(500, `No Studio found`)
	}

	// Then, continue as if it's a normal snapshot:

	if (!snapshot.snapshot) throw new Meteor.Error(500, `Restore input data is not a snapshot (${_.keys(snapshot)})`)

	if (snapshot.snapshot.type === SnapshotType.RUNDOWN) {
		// A snapshot of a rundown (to be deprecated)
		if ((snapshot as RundownPlaylistSnapshot).playlistId) {
			// temporary check, from snapshots where the type was rundown, but it actually was a rundownPlaylist
			return restoreFromRundownPlaylistSnapshot(snapshot as RundownPlaylistSnapshot)
		} else {
			return restoreFromDeprecatedRundownSnapshot(snapshot as DeprecatedRundownSnapshot)
		}
	} else if (snapshot.snapshot.type === SnapshotType.RUNDOWNPLAYLIST) {
		// A snapshot of a rundownPlaylist
		return restoreFromRundownPlaylistSnapshot(snapshot as RundownPlaylistSnapshot)
	} else if (snapshot.snapshot.type === SnapshotType.SYSTEM) {
		// A snapshot of a system
		return restoreFromSystemSnapshot(snapshot as SystemSnapshot)
	} else {
		throw new Meteor.Error(402, `Unknown snapshot type "${snapshot.snapshot.type}"`)
	}
}

async function restoreFromDeprecatedRundownSnapshot(snapshot0: DeprecatedRundownSnapshot) {
	// Convert the Rundown snaphost into a rundown playlist
	// This is somewhat of a hack, it's just to be able to import older snapshots into the system

	const snapshot = _.clone(snapshot0) as any as RundownPlaylistSnapshot

	// Make up a rundownPlaylist:
	snapshot.playlist = makePlaylistFromRundown_1_0_0(snapshot0.rundown)
	snapshot.playlistId = snapshot.playlist._id

	delete snapshot['rundown']
	snapshot.rundowns = [snapshot0.rundown]
	snapshot.rundowns[0]._rank = 0
	snapshot.rundowns[0].playlistId = snapshot.playlist._id

	return restoreFromRundownPlaylistSnapshot(snapshot)
}
export async function restoreFromRundownPlaylistSnapshot(
	snapshot: RundownPlaylistSnapshot,
	studioId?: StudioId,
	showStyleId?: ShowStyleBaseId
): Promise<void> {
	logger.info(`Restoring from rundown snapshot "${snapshot.snapshot.name}"`)
	const oldPlaylistId = snapshot.playlistId

	if (!isVersionSupported(parseVersion(snapshot.version || '0.18.0'))) {
		throw new Meteor.Error(400, `Cannot restore, the snapshot comes from an older, unsupported version of Sofie`)
	}

	if (oldPlaylistId !== snapshot.playlist._id)
		throw new Meteor.Error(
			500,
			`Restore snapshot: playlistIds don\'t match, "${oldPlaylistId}", "${snapshot.playlist._id}!"`
		)

	// const dbPlaylist = RundownPlaylists.findOne(playlistId)
	// const dbRundowns = dbPlaylist ? dbPlaylist.getRundowns() : []
	// const dbRundownMap = normalizeArray(dbRundowns, '_id')

	// const unsynced = dbRundowns.reduce((p, v) => (p || v.unsynced), false)
	// if (unsynced) throw new Meteor.Error(500, `Not allowed to restore into synced Rundown!`)
	if (!studioId) {
		const studios = await Studios.findFetchAsync({})
		const snapshotStudioExists = studios.find((studio) => studio._id === snapshot.playlist.studioId)
		if (studios.length >= 1 && !snapshotStudioExists) {
			// TODO Choose better than just the first
			snapshot.playlist.studioId = studios[0]._id
		}
	} else {
		snapshot.playlist.studioId = studioId
	}

	const playlistId = (snapshot.playlist._id = getRandomId())
	snapshot.playlist.restoredFromSnapshotId = snapshot.playlistId
	delete snapshot.playlist.activationId

	const showStyleVariants = await ShowStyleVariants.findFetchAsync({}) // TODO - this should be constrained by those allowed for the studio
	for (const rd of snapshot.rundowns) {
		if (!rd.orphaned) {
			rd.orphaned = 'from-snapshot'
		}

		rd.playlistId = playlistId
		rd.restoredFromSnapshotId = rd._id
		delete rd.peripheralDeviceId
		rd.studioId = snapshot.playlist.studioId
		rd.notifiedCurrentPlayingPartExternalId = undefined

		const snapshotShowStyleVariantExists = showStyleVariants.find(
			(variant) => variant._id === rd.showStyleVariantId && variant.showStyleBaseId === rd.showStyleBaseId
		)
		if (!showStyleId) {
			if (showStyleVariants.length >= 1 && !snapshotShowStyleVariantExists) {
				// TODO Choose better than just the first
				rd.showStyleBaseId = showStyleVariants[0].showStyleBaseId
				rd.showStyleVariantId = showStyleVariants[0]._id
			}
		} else {
			rd.showStyleBaseId = showStyleId
		}
	}

	// Migrate old data:
	// 1.12.0 Release 24:
	const partSegmentIds: { [partId: string]: SegmentId } = {}
	for (const part of snapshot.parts) {
		partSegmentIds[unprotectString(part._id)] = part.segmentId
	}
	for (const piece of snapshot.pieces) {
		const pieceOld = piece as any as Partial<Piece_1_11_0>
		if (pieceOld.rundownId) {
			piece.startRundownId = pieceOld.rundownId
			delete pieceOld.rundownId
		}
		if (pieceOld.partId) {
			piece.startPartId = pieceOld.partId
			delete pieceOld.partId
			piece.startSegmentId = partSegmentIds[unprotectString(piece.startPartId)]
		}
	}

	// List any ids that need updating on other documents
	const rundownIdMap = new Map<RundownId, RundownId>()
	const getNewRundownId = (oldRundownId: RundownId) => {
		const rundownId = rundownIdMap.get(oldRundownId)
		if (!rundownId) {
			throw new Meteor.Error(500, `Could not find new rundownId for "${oldRundownId}"`)
		}
		return rundownId
	}
	for (const rd of snapshot.rundowns) {
		const oldId = rd._id
		rd._id = getRandomId()
		rundownIdMap.set(oldId, rd._id)
	}
	const partIdMap = new Map<PartId, PartId>()
	for (const part of snapshot.parts) {
		const oldId = part._id
		part._id = part.externalId ? getPartId(getNewRundownId(part.rundownId), part.externalId) : getRandomId()

		partIdMap.set(oldId, part._id)
	}
	const partInstanceIdMap = new Map<PartInstanceId, PartInstanceId>()
	for (const partInstance of snapshot.partInstances) {
		const oldId = partInstance._id
		partInstance._id = getRandomId()
		partInstanceIdMap.set(oldId, partInstance._id)
		partInstance.part._id = partIdMap.get(partInstance.part._id) || getRandomId()
	}
	const segmentIdMap = new Map<SegmentId, SegmentId>()
	for (const segment of snapshot.segments) {
		const oldId = segment._id
		segment._id = getSegmentId(getNewRundownId(segment.rundownId), segment.externalId)
		segmentIdMap.set(oldId, segment._id)
	}
	type AnyPieceId = PieceId | AdLibActionId | RundownBaselineAdLibActionId
	const pieceIdMap = new Map<AnyPieceId, AnyPieceId>()
	for (const piece of snapshot.pieces) {
		const oldId = piece._id
		piece.startRundownId = getNewRundownId(piece.startRundownId)
		piece.startPartId =
			partIdMap.get(piece.startPartId) ||
			getRandomIdAndWarn(`piece.startPartId=${piece.startPartId} of piece=${piece._id}`)
		piece.startSegmentId =
			segmentIdMap.get(piece.startSegmentId) ||
			getRandomIdAndWarn(`piece.startSegmentId=${piece.startSegmentId} of piece=${piece._id}`)
		piece._id = getRandomId()
		pieceIdMap.set(oldId, piece._id)
	}
	for (const adlib of [
		...snapshot.adLibPieces,
		...snapshot.adLibActions,
		...snapshot.baselineAdlibs,
		...snapshot.baselineAdLibActions,
	]) {
		const oldId = adlib._id
		if (adlib.partId) adlib.partId = partIdMap.get(adlib.partId)
		adlib._id = getRandomId()
		pieceIdMap.set(oldId, adlib._id)
	}

	for (const pieceInstance of snapshot.pieceInstances) {
		pieceInstance._id = getRandomId()

		pieceInstance.piece._id = (pieceIdMap.get(pieceInstance.piece._id) || getRandomId()) as PieceId // Note: don't warn if not found, as the piece may have been deleted
		if (pieceInstance.infinite) {
			pieceInstance.infinite.infinitePieceId =
				pieceIdMap.get(pieceInstance.infinite.infinitePieceId) || getRandomId() // Note: don't warn if not found, as the piece may have been deleted
		}
	}

	if (snapshot.playlist.currentPartInstanceId) {
		snapshot.playlist.currentPartInstanceId =
			partInstanceIdMap.get(snapshot.playlist.currentPartInstanceId) || snapshot.playlist.currentPartInstanceId
	}
	if (snapshot.playlist.nextPartInstanceId) {
		snapshot.playlist.nextPartInstanceId =
			partInstanceIdMap.get(snapshot.playlist.nextPartInstanceId) || snapshot.playlist.nextPartInstanceId
	}
	if (snapshot.playlist.previousPartInstanceId) {
		snapshot.playlist.previousPartInstanceId =
			partInstanceIdMap.get(snapshot.playlist.previousPartInstanceId) || snapshot.playlist.previousPartInstanceId
	}

	for (const expectedPackage of snapshot.expectedPackages) {
		switch (expectedPackage.fromPieceType) {
			case ExpectedPackageDBType.PIECE:
			case ExpectedPackageDBType.ADLIB_PIECE:
			case ExpectedPackageDBType.ADLIB_ACTION:
			case ExpectedPackageDBType.BASELINE_ADLIB_PIECE:
			case ExpectedPackageDBType.BASELINE_ADLIB_ACTION: {
				expectedPackage.pieceId =
					pieceIdMap.get(expectedPackage.pieceId) ||
					getRandomIdAndWarn(`expectedPackage.pieceId=${expectedPackage.pieceId}`)
				expectedPackage._id = getExpectedPackageId(expectedPackage.pieceId, expectedPackage.blueprintPackageId)

				break
			}
			case ExpectedPackageDBType.RUNDOWN_BASELINE_OBJECTS: {
				expectedPackage._id = getExpectedPackageId(
					expectedPackage.rundownId,
					expectedPackage.blueprintPackageId
				)
				break
			}
			case ExpectedPackageDBType.BUCKET_ADLIB:
			case ExpectedPackageDBType.BUCKET_ADLIB_ACTION:
			case ExpectedPackageDBType.STUDIO_BASELINE_OBJECTS: {
				// ignore, these are not present in the rundown snapshot anyway.
				logger.warn(`Unexpected ExpectedPackage in snapshot: ${JSON.stringify(expectedPackage)}`)
				break
			}

			default:
				assertNever(expectedPackage)
				break
		}
	}

	const rundownIds = snapshot.rundowns.map((r) => r._id)

	// Apply the updates of any properties to any document
	function updateItemIds<
		T extends {
			_id: ProtectedString<any>
			rundownId?: RundownId
			partInstanceId?: PartInstanceId
			partId?: PartId
			segmentId?: SegmentId
			part?: unknown
			piece?: unknown
		}
	>(objs: undefined | T[], updateId: boolean): T[] {
		const updateIds = (obj: T) => {
			if (obj.rundownId) {
				obj.rundownId = getNewRundownId(obj.rundownId)
			}

			if (obj.partId) {
				obj.partId = partIdMap.get(obj.partId) || getRandomId()
			}
			if (obj.segmentId) {
				obj.segmentId = segmentIdMap.get(obj.segmentId) || getRandomId()
			}
			if (obj.partInstanceId) {
				obj.partInstanceId = partInstanceIdMap.get(obj.partInstanceId) || getRandomId()
			}

			if (updateId) {
				obj._id = getRandomId()
			}

			if (obj.part) {
				updateIds(obj.part as any)
			}
			if (obj.piece) {
				updateIds(obj.piece as any)
			}

			return obj
		}
		return (objs || []).map((obj) => updateIds(obj))
	}

	await Promise.all([
		saveIntoDb(RundownPlaylists, { _id: playlistId }, [snapshot.playlist]),
		saveIntoDb(Rundowns, { playlistId }, snapshot.rundowns),
		saveIntoDb(IngestDataCache, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.ingestData, true)),
		// saveIntoDb(UserActionsLog, {}, snapshot.userActions),
		saveIntoDb(RundownBaselineObjs, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.baselineObjs, true)),
		saveIntoDb(
			RundownBaselineAdLibPieces,
			{ rundownId: { $in: rundownIds } },
			updateItemIds(snapshot.baselineAdlibs, true)
		),
		saveIntoDb(
			RundownBaselineAdLibActions,
			{ rundownId: { $in: rundownIds } },
			updateItemIds(snapshot.baselineAdLibActions, true)
		),
		saveIntoDb(Segments, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.segments, false)),
		saveIntoDb(Parts, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.parts, false)),
		saveIntoDb(PartInstances, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.partInstances, false)),
		saveIntoDb(Pieces, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.pieces, false)),
		saveIntoDb(PieceInstances, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.pieceInstances, false)),
		saveIntoDb(AdLibPieces, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.adLibPieces, true)),
		saveIntoDb(AdLibActions, { rundownId: { $in: rundownIds } }, updateItemIds(snapshot.adLibActions, true)),
		saveIntoDb(
			MediaObjects,
			{ _id: { $in: _.map(snapshot.mediaObjects, (mediaObject) => mediaObject._id) } },
			snapshot.mediaObjects
		),
		saveIntoDb(
			ExpectedMediaItems,
			{ partId: { $in: protectStringArray(_.keys(partIdMap)) } },
			updateItemIds(snapshot.expectedMediaItems, true)
		),
		saveIntoDb(
			ExpectedPlayoutItems,
			{ rundownId: { $in: rundownIds } },
			updateItemIds(snapshot.expectedPlayoutItems || [], false)
		),
		saveIntoDb(
			ExpectedPackages,
			{ rundownId: { $in: rundownIds } },
			updateItemIds(snapshot.expectedPackages || [], false)
		),
	])

	logger.info(`Restore done`)
}
function getRandomIdAndWarn<T extends ProtectedString<any>>(name: string): T {
	logger.warn(`Couldn't find "${name}" when restoring snapshot`)
	return getRandomId<T>()
}
async function restoreFromSystemSnapshot(snapshot: SystemSnapshot): Promise<void> {
	logger.info(`Restoring from system snapshot "${snapshot.snapshot.name}"`)
	const studioId = snapshot.studioId

	if (!isVersionSupported(parseVersion(snapshot.version || '0.18.0'))) {
		throw new Meteor.Error(400, `Cannot restore, the snapshot comes from an older, unsupported version of Sofie`)
	}
	// Migrate data changes:
	snapshot.studios = _.map(snapshot.studios, (studio) => {
		if (!studio.routeSets) studio.routeSets = {}
		return migrateConfigToBlueprintConfigOnObject(studio)
	})
	snapshot.showStyleBases = _.map(snapshot.showStyleBases, (showStyleBase) => {
		// delete showStyleBase.runtimeArguments // todo: add this?
		return migrateConfigToBlueprintConfigOnObject(showStyleBase)
	})
	snapshot.showStyleVariants = _.map(snapshot.showStyleVariants, (showStyleVariant) => {
		return migrateConfigToBlueprintConfigOnObject(showStyleVariant)
	})
	if (snapshot.blueprints) {
		snapshot.blueprints = _.map(snapshot.blueprints, (bp) => {
			bp.hasCode = !!bp.code
			return bp
		})
	}

	const changes = sumChanges(
		...(await Promise.all([
			saveIntoDb(Studios, studioId ? { _id: studioId } : {}, snapshot.studios),
			saveIntoDb(ShowStyleBases, {}, snapshot.showStyleBases),
			saveIntoDb(ShowStyleVariants, {}, snapshot.showStyleVariants),
			snapshot.blueprints ? saveIntoDb(Blueprints, {}, snapshot.blueprints) : null,
			snapshot.rundownLayouts ? saveIntoDb(RundownLayouts, {}, snapshot.rundownLayouts) : null,
			snapshot.triggeredActions ? saveIntoDb(TriggeredActions, {}, snapshot.triggeredActions) : null,
			saveIntoDb(PeripheralDevices, studioId ? { studioId: studioId } : {}, snapshot.devices),
			saveIntoDb(CoreSystem, {}, [snapshot.coreSystem]),
		]))
	)
	// saveIntoDb(PeripheralDeviceCommands, {}, snapshot.deviceCommands) // ignored

	logger.info(
		`Restore done (added ${changes.added}, updated ${changes.updated}, removed ${changes.removed} documents)`
	)
}
/** Take and store a system snapshot */
export async function storeSystemSnapshot(
	context: MethodContext,
	studioId: StudioId | null,
	reason: string
): Promise<SnapshotId> {
	if (!_.isNull(studioId)) check(studioId, String)
	const { organizationId, cred } = OrganizationContentWriteAccess.snapshot(context)
	if (Settings.enableUserAccounts && isResolvedCredentials(cred)) {
		if (cred.user && !cred.user.superAdmin) throw new Meteor.Error(401, 'Only Super Admins can store Snapshots')
	}
	return internalStoreSystemSnapshot(organizationId, studioId, reason)
}
/** Take and store a system snapshot. For internal use only, performs no access control. */
export async function internalStoreSystemSnapshot(
	organizationId: OrganizationId | null,
	studioId: StudioId | null,
	reason: string
): Promise<SnapshotId> {
	if (!_.isNull(studioId)) check(studioId, String)

	const s = await createSystemSnapshot(studioId, organizationId)
	return storeSnaphot(s, organizationId, reason)
}
export async function storeRundownPlaylistSnapshot(
	access: BasicAccessContext,
	playlistId: RundownPlaylistId,
	reason: string,
	full?: boolean
): Promise<SnapshotId> {
	check(playlistId, String)
	return internalStoreRundownPlaylistSnapshot(access.organizationId, playlistId, reason, full)
}
/** Take and store a rundoen playlist snapshot. For internal use only, performs no access control. */
export async function internalStoreRundownPlaylistSnapshot(
	organizationId: OrganizationId | null,
	playlistId: RundownPlaylistId,
	reason: string,
	full?: boolean
) {
	check(playlistId, String)
	check(full, Match.Maybe(Boolean))

	const s = await createRundownPlaylistSnapshot(playlistId, organizationId, full)
	return storeSnaphot(s, organizationId, reason)
}
export async function storeDebugSnapshot(
	context: MethodContext,
	studioId: StudioId,
	reason: string
): Promise<SnapshotId> {
	check(studioId, String)
	const { organizationId, cred } = OrganizationContentWriteAccess.snapshot(context)
	if (Settings.enableUserAccounts && isResolvedCredentials(cred)) {
		if (cred.user && !cred.user.superAdmin) throw new Meteor.Error(401, 'Only Super Admins can store Snapshots')
	}
	const s = await createDebugSnapshot(studioId, organizationId)
	return storeSnaphot(s, organizationId, reason)
}
export async function restoreSnapshot(context: MethodContext, snapshotId: SnapshotId): Promise<void> {
	check(snapshotId, String)
	const { cred } = OrganizationContentWriteAccess.snapshot(context)
	if (Settings.enableUserAccounts && isResolvedCredentials(cred)) {
		if (cred.user && !cred.user.superAdmin) throw new Meteor.Error(401, 'Only Super Admins can store Snapshots')
	}
	const snapshot = await retreiveSnapshot(snapshotId, context)
	return restoreFromSnapshot(snapshot)
}
export async function removeSnapshot(context: MethodContext, snapshotId: SnapshotId): Promise<void> {
	check(snapshotId, String)
	const { snapshot, cred } = OrganizationContentWriteAccess.snapshot(context, snapshotId)
	if (Settings.enableUserAccounts && isResolvedCredentials(cred)) {
		if (cred.user && !cred.user.superAdmin) throw new Meteor.Error(401, 'Only Super Admins can store Snapshots')
	}
	logger.info(`Removing snapshot ${snapshotId}`)

	if (!snapshot) throw new Meteor.Error(404, `Snapshot "${snapshotId}" not found!`)

	if (snapshot.fileName) {
		// remove from disk
		const system = getCoreSystem()
		if (!system) throw new Meteor.Error(500, `CoreSystem not found!`)
		if (!system.storePath) throw new Meteor.Error(500, `CoreSystem.storePath not set!`)

		const filePath = Path.join(system.storePath, snapshot.fileName)
		try {
			logger.info(`Removing snapshot file ${filePath}`)

			if (!Meteor.isTest) {
				// If we're running in a unit-test, don't access files
				await fs.promises.unlink(filePath)
			}
		} catch (e) {
			// Log the error, but continue
			logger.error('Error in removeSnapshot')
			logger.error(e)
		}
	}
	await Snapshots.removeAsync(snapshot._id)
}
if (!Settings.enableUserAccounts) {
	// For backwards compatibility:

	PickerGET.route('/snapshot/system/:studioId', async (params, req: IncomingMessage, response: ServerResponse) => {
		return handleResponse(response, async () => {
			check(params.studioId, Match.Optional(String))

			const cred0: Credentials = { userId: null, token: params.token }
			const { organizationId, cred } = OrganizationContentWriteAccess.snapshot(cred0)
			StudioReadAccess.studio({ _id: protectString(params.studioId) }, cred)

			return createSystemSnapshot(protectString(params.studioId), organizationId)
		})
	})
	async function createRundownSnapshot(response: ServerResponse, params) {
		return handleResponse(response, async () => {
			check(params.playlistId, String)
			check(params.full, Match.Optional(String))

			const cred0: Credentials = { userId: null, token: params.token }
			const { organizationId, cred } = OrganizationContentWriteAccess.snapshot(cred0)
			const playlist = RundownPlaylists.findOne(protectString(params.playlistId))
			if (!playlist) throw new Meteor.Error(404, `RundownPlaylist "${params.playlistId}" not found`)
			StudioReadAccess.studioContent({ studioId: playlist.studioId }, cred)

			return createRundownPlaylistSnapshot(playlist._id, organizationId, params.full === 'true')
		})
	}
	PickerGET.route('/snapshot/rundown/:playlistId', async (params, req: IncomingMessage, response: ServerResponse) =>
		createRundownSnapshot(response, params)
	)
	PickerGET.route(
		'/snapshot/rundown/:playlistId/:full',
		async (params, req: IncomingMessage, response: ServerResponse) => createRundownSnapshot(response, params)
	)
	PickerGET.route('/snapshot/debug/:studioId', async (params, req: IncomingMessage, response: ServerResponse) => {
		return handleResponse(response, async () => {
			check(params.studioId, String)

			const cred0: Credentials = { userId: null, token: params.token }
			const { organizationId, cred } = OrganizationContentWriteAccess.snapshot(cred0)
			StudioReadAccess.studio({ _id: protectString(params.studioId) }, cred)

			return createDebugSnapshot(protectString(params.studioId), organizationId)
		})
	})
}
PickerPOST.route('/snapshot/restore', async (params, req: IncomingMessage, response: ServerResponse) => {
	const content = 'ok'
	try {
		response.setHeader('Content-Type', 'text/plain')
		let snapshot = req.body as any
		if (!snapshot) throw new Meteor.Error(400, 'Restore Snapshot: Missing request body')

		if (typeof snapshot !== 'object') {
			// sometimes, the browser can send the JSON with wrong mimetype, resulting in it not being parsed
			snapshot = JSON.parse(snapshot)
		}

		await restoreFromSnapshot(snapshot)

		response.statusCode = 200
		response.end(content)
	} catch (e) {
		response.setHeader('Content-Type', 'text/plain')
		response.statusCode = e instanceof Meteor.Error && typeof e.error === 'number' ? e.error : 500
		response.end('Error: ' + stringifyError(e))

		if (response.statusCode !== 404) {
			logger.error(stringifyError(e))
		}
	}
})
if (!Settings.enableUserAccounts) {
	// For backwards compatibility:

	// Retrieve snapshot:
	PickerGET.route(
		'/snapshot/retrieve/:snapshotId',
		async (params, req: IncomingMessage, response: ServerResponse) => {
			return handleResponse(response, async () => {
				check(params.snapshotId, String)
				return retreiveSnapshot(protectString(params.snapshotId), { userId: null })
			})
		}
	)
}
// Retrieve snapshot:
PickerGET.route(
	'/snapshot/:token/retrieve/:snapshotId',
	async (params, req: IncomingMessage, response: ServerResponse) => {
		return handleResponse(response, async () => {
			check(params.snapshotId, String)
			return retreiveSnapshot(protectString(params.snapshotId), { userId: null, token: params.token })
		})
	}
)

class ServerSnapshotAPI extends MethodContextAPI implements NewSnapshotAPI {
	async storeSystemSnapshot(studioId: StudioId | null, reason: string) {
		return storeSystemSnapshot(this, studioId, reason)
	}
	async storeRundownPlaylist(playlistId: RundownPlaylistId, reason: string) {
		check(playlistId, String)
		const access = OrganizationContentWriteAccess.snapshot(this)
		return storeRundownPlaylistSnapshot(access, playlistId, reason)
	}
	async storeDebugSnapshot(studioId: StudioId, reason: string) {
		return storeDebugSnapshot(this, studioId, reason)
	}
	async restoreSnapshot(snapshotId: SnapshotId) {
		return restoreSnapshot(this, snapshotId)
	}
	async removeSnapshot(snapshotId: SnapshotId) {
		return removeSnapshot(this, snapshotId)
	}
}
registerClassToMeteorMethods(SnapshotAPIMethods, ServerSnapshotAPI, false)
