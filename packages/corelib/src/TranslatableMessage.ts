import {
	IBlueprintActionManifest,
	ITranslatableMessage as IBlueprintTranslatableMessage,
} from '@sofie-automation/blueprints-integration'
import { TFunction } from 'i18next'
import { BucketAdLibAction } from './dataModel/BucketAdLibAction'
import { BlueprintId } from './dataModel/Ids'
import { ArrayElement } from './lib'
import { unprotectString } from './protectedString'

/**
 * @enum - A translatable message (i18next)
 */
export interface ITranslatableMessage extends IBlueprintTranslatableMessage {
	/** namespace used */
	namespaces?: Array<string>
}

/**
 * Convenience function to translate a message using a supplied translation function.
 *
 * @param {ITranslatableMessage} translatable - the translatable to translate
 * @param {TFunction} i18nTranslator - the translation function to use
 * @returns the translation with arguments applied
 */
export function translateMessage(translatable: ITranslatableMessage, i18nTranslator: TFunction): string {
	// the reason for injecting the translation function rather than including the inited function from i18n.ts
	// is to avoid a situation where this is accidentally used from the server side causing an error
	const { key: message, args, namespaces } = translatable

	return i18nTranslator(message, { ns: namespaces, replace: { ...args } })
}

/**
 * Interpollate a translation key using the provided args. This can be used in the backend to compile the actual string
 * (at least a single, probably English, version) presented to the user, for use in logs and such.
 *
 * @export
 * @param {unknown} key Translation key, usually with interpollation handle-bar syntax placeholders
 * @param {...any} args Map of values to be inserted in place of placeholders
 * @return {string} the compiled string
 */
export function interpollateTranslation(key: unknown, ...args: any[]): string {
	if (!args[0]) {
		return String(key)
	}

	if (typeof args[0] === 'string') {
		return String(key || args[0])
	}

	if (args[0].defaultValue) {
		return args[0].defaultValue
	}

	if (typeof key !== 'string') {
		return String(key)
	}

	const options = args[0]
	if (options?.replace) {
		Object.assign(options, { ...options.replace })
	}

	let interpolated = String(key)
	for (const placeholder of key.match(/[^{}]+(?=})/g) || []) {
		const value = options[placeholder] || placeholder
		interpolated = interpolated.replace(`{{${placeholder}}}`, value)
	}

	return interpolated
}

/**
 * Type check predicate for the ITranslatableMessage interface
 *
 * @param obj the value to typecheck
 *
 * @returns {boolean} true if the value implements the interface, false if not
 */
export function isTranslatableMessage(obj: unknown): obj is ITranslatableMessage {
	if (!obj) {
		return false
	}

	const { key, args, namespaces } = obj as ITranslatableMessage

	if (!key || typeof key !== 'string') {
		return false
	}

	if (args && !checkArgs(args)) {
		return false
	}

	if (namespaces && (!Array.isArray(namespaces) || namespaces.find((ns: any) => typeof ns !== 'string'))) {
		return false
	}

	return true
}

/**
 * A utility function to add namespaces to ITranslatableMessages found in AdLib Actions
 *
 * @export
 * @template K
 * @template T
 * @param {T} itemOrig
 * @param {BlueprintId} blueprintId
 * @param {number} [rank]
 * @return {*}  {(Pick<K, 'display' | 'triggerModes'>)}
 */
export function processAdLibActionITranslatableMessages<
	K extends {
		display: IBlueprintActionManifest['display'] & {
			label: ITranslatableMessage
			triggerLabel?: ITranslatableMessage
			description?: ITranslatableMessage
		}
		triggerModes?: (ArrayElement<IBlueprintActionManifest['triggerModes']> & {
			display: ArrayElement<IBlueprintActionManifest['triggerModes']>['display'] & {
				label: ITranslatableMessage
				description?: ITranslatableMessage
			}
		})[]
	},
	T extends IBlueprintActionManifest
>(itemOrig: T, blueprintId: BlueprintId, rank?: number): Pick<K, 'display' | 'triggerModes'> {
	return {
		display: {
			...itemOrig.display,
			_rank: rank ?? itemOrig.display._rank,
			label: {
				...itemOrig.display.label,
				namespaces: [unprotectString(blueprintId)],
			},
			triggerLabel: itemOrig.display.triggerLabel && {
				...itemOrig.display.triggerLabel,
				namespaces: [unprotectString(blueprintId)],
			},
			description: itemOrig.display.description && {
				...itemOrig.display.description,
				namespaces: [unprotectString(blueprintId)],
			},
		},
		triggerModes:
			itemOrig.triggerModes &&
			itemOrig.triggerModes.map(
				(triggerMode): ArrayElement<BucketAdLibAction['triggerModes']> => ({
					...triggerMode,
					display: {
						...triggerMode.display,
						label: {
							...triggerMode.display.label,
							namespaces: [unprotectString(blueprintId)],
						},
						description: triggerMode.display.description && {
							...triggerMode.display.description,
							namespaces: [unprotectString(blueprintId)],
						},
					},
				})
			),
	}
}

function checkArgs(args: any): args is { [key: string]: any } {
	if (args === undefined || args === null) {
		return false
	}

	// this is good enough for object literals and arrays, which is what args can be
	return args.constructor === Object || Array.isArray(args)
}
