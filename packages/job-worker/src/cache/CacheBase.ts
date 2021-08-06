import { ProtectedString } from '@sofie-automation/corelib/dist/protectedString'
import * as _ from 'underscore'
import { DbCacheReadCollection, DbCacheWriteCollection } from './CacheCollection'
import { DbCacheReadObject, DbCacheWriteObject, DbCacheWriteOptionalObject } from './CacheObject'
import { isDbCacheWritable } from './lib'
import { anythingChanged, sumChanges } from '../db/changes'
import { IS_PRODUCTION } from '../environment'
import { logger } from '../logging'
import { sleep } from '@sofie-automation/corelib/dist/lib'
import { JobContext } from '../jobs'

type DeferredFunction<Cache> = (cache: Cache) => void | Promise<void>

type DbCacheWritable<TDoc extends { _id: ProtectedString<any> }> =
	| DbCacheWriteCollection<TDoc>
	| DbCacheWriteObject<TDoc>
	| DbCacheWriteOptionalObject<TDoc>

export type ReadOnlyCacheInner<T> = T extends DbCacheWriteCollection<infer A>
	? DbCacheReadCollection<A>
	: T extends DbCacheWriteObject<infer A>
	? DbCacheReadObject<A>
	: T extends DbCacheWriteOptionalObject<infer A>
	? DbCacheReadObject<A, true>
	: T
export type ReadOnlyCache<T extends CacheBase<any>> = Omit<
	{ [K in keyof T]: ReadOnlyCacheInner<T[K]> },
	'defer' | 'deferAfterSave' | 'saveAllToDatabase'
>

/** This cache contains data relevant in a studio */
export abstract class ReadOnlyCacheBase<T extends ReadOnlyCacheBase<never>> {
	protected _deferredFunctions: DeferredFunction<T>[] = []
	protected _deferredAfterSaveFunctions: (() => void | Promise<void>)[] = []

	constructor(protected readonly context: JobContext) {
		context.trackCache(this)
	}

	protected getAllCollections() {
		const highPrioDBs: DbCacheWritable<any>[] = []
		const lowPrioDBs: DbCacheWritable<any>[] = []

		for (const [key, db0] of Object.entries(this)) {
			let db = db0
			if (db && typeof db === 'object' && 'getIfLoaded' in db) {
				// If wrapped in a lazy
				db = db.getIfLoaded()
			}
			if (db && isDbCacheWritable(db)) {
				if (key.match(/timeline/i)) {
					highPrioDBs.push(db)
				} else {
					lowPrioDBs.push(db)
				}
			}
		}

		return {
			allDBs: [...highPrioDBs, ...lowPrioDBs],
			highPrioDBs,
			lowPrioDBs,
		}
	}

	async saveAllToDatabase() {
		const span = this.context.startSpan('Cache.saveAllToDatabase')

		// Execute cache.defer()'s
		for (let i = 0; i < this._deferredFunctions.length; i++) {
			await this._deferredFunctions[i](this as any)
		}
		this._deferredFunctions.length = 0 // clear the array

		const { highPrioDBs, lowPrioDBs } = this.getAllCollections()

		if (highPrioDBs.length) {
			const anyThingChanged = anythingChanged(
				sumChanges(...(await Promise.all(highPrioDBs.map(async (db) => db.updateDatabaseWithData()))))
			)
			if (anyThingChanged) {
				// Wait a little bit before saving the rest.
				// The idea is that this allows for the high priority publications to update (such as the Timeline),
				// sending the updated timeline to Playout-gateway
				await sleep(2)
			}
		}

		if (lowPrioDBs.length) {
			await Promise.all(lowPrioDBs.map(async (db) => db.updateDatabaseWithData()))
		}

		// Execute cache.deferAfterSave()'s
		for (let i = 0; i < this._deferredAfterSaveFunctions.length; i++) {
			await this._deferredAfterSaveFunctions[i]()
		}
		this._deferredAfterSaveFunctions.length = 0 // clear the array

		if (span) span.end()
	}

	/**
	 * Discard all changes to documents in the cache.
	 * This essentially acts as rolling back this transaction, and lets the cache be reused for another operation instead
	 */
	discardChanges() {
		const { allDBs } = this.getAllCollections()
		for (const coll of allDBs) {
			coll.discardChanges()
		}

		// Discard any hooks too
		this._deferredAfterSaveFunctions.length = 0
		this._deferredFunctions.length = 0
	}

	/** Inform all the collections of the intention for the Cache to be removed. The collections are emptied and marked to reject any further updates */
	protected markCollectionsForRemoval(): void {
		const { allDBs } = this.getAllCollections()
		for (const coll of allDBs) {
			coll.markForRemoval()
		}
	}

	/**
	 * Assert that no changes should have been made to the cache, will throw an Error otherwise. This can be used in
	 * place of `saveAllToDatabase()`, when the code controlling the cache expects no changes to have been made and any
	 * changes made are an error and will cause issues.
	 */
	assertNoChanges(): void {
		const span = this.context.startSpan('Cache.assertNoChanges')

		function logOrThrowError(error: Error) {
			if (!IS_PRODUCTION) {
				throw error
			} else {
				logger.error(error.toString())
				if (error.stack) logger.error(error.stack)
			}
		}

		const { allDBs } = this.getAllCollections()

		if (this._deferredFunctions.length > 0)
			logOrThrowError(
				new Error(
					`Failed no changes in cache assertion, there were ${this._deferredFunctions.length} deferred functions`
				)
			)

		if (this._deferredAfterSaveFunctions.length > 0)
			logOrThrowError(
				new Error(
					`Failed no changes in cache assertion, there were ${this._deferredAfterSaveFunctions.length} after-save deferred functions`
				)
			)

		_.map(allDBs, (db) => {
			if (db.isModified()) {
				logOrThrowError(
					new Error(`Failed no changes in cache assertion, cache was modified: collection: ${db.name}`)
				)
			}
		})

		if (span) span.end()
	}

	hasChanges(): boolean {
		const { allDBs } = this.getAllCollections()

		if (this._deferredFunctions.length > 0) return true

		if (this._deferredAfterSaveFunctions.length > 0) return true

		for (const db of allDBs) {
			if (db.isModified()) {
				return true
			}
		}

		return false
	}
}
export abstract class CacheBase<T extends CacheBase<any>> extends ReadOnlyCacheBase<T> {
	/** Defer provided function (it will be run just before cache.saveAllToDatabase() ) */
	defer(fcn: DeferredFunction<T>): void {
		this._deferredFunctions.push(fcn)
	}
	/** Defer provided function to after cache.saveAllToDatabase().
	 * Note that at the time of execution, the cache is no longer available.
	 * */
	deferAfterSave(fcn: () => void | Promise<void>): void {
		this._deferredAfterSaveFunctions.push(fcn)
	}
}
