import {
	RundownLayoutBase,
	RundownLayout,
	DashboardLayout,
	RundownLayoutType,
	RundownLayoutElementBase,
	RundownLayoutFilterBase,
	RundownLayoutElementType,
	RundownLayoutExternalFrame,
	RundownLayoutAdLibRegion,
	PieceDisplayStyle,
	RundownLayoutKeyboardPreview,
	RundownLayoutPartCountdown,
} from '../collections/RundownLayouts'
import * as _ from 'underscore'

export namespace RundownLayoutsAPI {
	export enum methods {
		'removeRundownLayout' = 'rundown.removeRundownLayout',
		'createRundownLayout' = 'rundown.createRundownLayout'
	}

	export function isRundownLayout (layout: RundownLayoutBase): layout is RundownLayout {
		return layout.type === RundownLayoutType.RUNDOWN_LAYOUT
	}

	export function isDashboardLayout (layout: RundownLayoutBase): layout is DashboardLayout {
		return layout.type === RundownLayoutType.DASHBOARD_LAYOUT
	}

	export function isFilter (element: RundownLayoutElementBase): element is RundownLayoutFilterBase {
		return element.type === undefined || element.type === RundownLayoutElementType.FILTER
	}

	export function isExternalFrame (element: RundownLayoutElementBase): element is RundownLayoutExternalFrame {
		return element.type === RundownLayoutElementType.EXTERNAL_FRAME
	}

	export function isAdLibRegion (element: RundownLayoutElementBase): element is RundownLayoutAdLibRegion {
		return element.type === RundownLayoutElementType.ADLIB_REGION
	}

	export function isPartCountdown (element: RundownLayoutElementBase): element is RundownLayoutPartCountdown {
		return element.type === RundownLayoutElementType.PART_COUNTDOWN
	}

	export function isKeyboardMap (element: RundownLayoutElementBase): element is RundownLayoutKeyboardPreview {
		return element.type === RundownLayoutElementType.KEYBOARD_PREVIEW
	}

	export function adLibRegionToFilter (element: RundownLayoutAdLibRegion): RundownLayoutFilterBase {
		return {
			...(_.pick(element, '_id', 'name', 'rank', 'tags')),
			rundownBaseline: true,
			type: RundownLayoutElementType.FILTER,
			sourceLayerIds: [],
			sourceLayerTypes: [],
			outputLayerIds: [],
			label: [],
			displayStyle: PieceDisplayStyle.BUTTONS,
			currentSegment: false
		}
	}
}
