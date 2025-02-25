import { TranslationsBundle, TranslationsBundleId } from '../collections/TranslationsBundles'
import { ClientAPI } from './client'

export interface CollectionCleanupResult {
	[index: string]: {
		collectionName: string
		docsToRemove: number
	}
}

export interface BenchmarkResult {
	mongoWriteSmall: number
	mongoWriteBig: number
	mongoRead: number
	mongoIndexedRead: number
	cpuCalculations: number
	cpuStringifying: number
}
export interface SystemBenchmarkResults {
	description: string
	results: BenchmarkResult
}

export interface SystemAPI {
	cleanupIndexes(actuallyRemoveOldIndexes: boolean): Promise<any>
	cleanupOldData(actuallyRemoveOldData: boolean): Promise<CollectionCleanupResult | string>

	doSystemBenchmark(): Promise<SystemBenchmarkResults>

	getTranslationBundle(bundleId: TranslationsBundleId): Promise<ClientAPI.ClientResponse<TranslationsBundle>>
}

export enum SystemAPIMethods {
	'cleanupIndexes' = 'system.cleanupIndexes',
	'cleanupOldData' = 'system.cleanupOldData',
	'runCronjob' = 'system.runCronjob',
	'doSystemBenchmark' = 'system.doSystemBenchmark',
	'getTranslationBundle' = 'system.getTranslationBundle',
}
