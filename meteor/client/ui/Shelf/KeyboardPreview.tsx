import * as React from 'react'
import * as _ from 'underscore'
import * as classNames from 'classnames'
import { ISourceLayer } from 'tv-automation-sofie-blueprints-integration'
import { IHotkeyAssignment, RegisteredHotkeys } from '../../lib/hotkeyRegistry'
import { withTracker } from '../../lib/ReactMeteorData/ReactMeteorData';
import { MeteorReactComponent } from '../../lib/MeteorReactComponent';

declare global {
	type KeyboardLayoutMap = Map<string, string>

	type KeyboardLayoutEvents = 'layoutchange'

	interface Keyboard {
		getLayoutMap (): Promise<KeyboardLayoutMap>
		addEventListener (type: KeyboardLayoutEvents, listener: EventListener): void
		removeEventListener (type: KeyboardLayoutEvents, listener: EventListener): void
	}

	interface Navigator {
		keyboard: Keyboard
	}
}

export interface IHotkeyAssignmentExtended extends IHotkeyAssignment {
	finalKey: string
}

export type ParsedHotkeyAssignments = {
	[ modifiers: string ]: IHotkeyAssignmentExtended[]
}

export enum SpecialKeyPositions {
	BLANK_SPACE = '$space'
}

export interface KeyPositon {
	code: string
	width: number
	space?: true
}

/**
 * Order of keys is: Alphanum Row E...A, Function Section Row K, Control Pad E,
 * Control Pad D, Arrow Pad B, Arrow Pad A, Numpad Row E...A. Not all rows need to be specified.
 */
export type PhysicalLayout = KeyPositon[][]

export interface IProps {
	physicalLayout: PhysicalLayout
}

interface ITrackedProps {
	hotkeys: ParsedHotkeyAssignments
}

interface IState {
	layout: KeyboardLayoutMap | undefined
	keyDown: { [key: string]: boolean }
}

/**
 * Convert an array of strings into a PhysicalLayout.
 * See https://w3c.github.io/uievents-code/#keyboard-sections for rows and sections
 *
 * @param {string[]} shortForm Order of keys is: Alphanum Row E...A, Function Section Row K, Control Pad E,
 * 							   Control Pad D, Arrow Pad B, Arrow Pad A, Numpad Row E...A.
 * @returns {PhysicalLayout}
 */
function createPhysicalLayout(shortForm: string[]): PhysicalLayout {
	return shortForm.map((row) => {
		return _.compact(row.split(',').map((keyPosition) => {
			const args = keyPosition.split(':')
			return args[0] ? {
				code: args[1] ? args[1] : args[0],
				width: args[1] ?
					args[0] === 'X' ?
						-1 :
						parseFloat(args[0]) :
					3
			} : undefined
		}))
	})
}

export enum GenericFuncionalKeyLabels {
	Backspace = '⌫',
	Tab = 'Tab ⭾',
	CapsLock = 'CapsLock',
	Enter = 'Enter',
	ShiftLeft = 'Shift',
	ShiftRight = 'Shift',
	ControlLeft = 'Ctrl',
	MetaLeft = '❖',
	AltLeft = 'Alt',
	Space = ' ',
	AltRight = 'Alt',
	MetaRight = '❖',
	ContextMenu = '☰',
	ControlRight = 'Ctrl',

	Escape = 'Esc',

	Insert = 'Insert',
	Delete = 'Delete',
	Home = 'Home',
	End = 'End',
	PageUp = 'PgUp',
	PageDown = 'PgDn',

	ArrowUp = '⯅',
	ArrowDown = '⯆',
	ArrowLeft = '⯇',
	ArrowRight = '⯈'
}

export namespace KeyboardLayouts {
	export const STANDARD_102: PhysicalLayout = createPhysicalLayout([
		// Row E
		'Backquote,Digit1,Digit2,Digit3,Digit4,Digit5,Digit6,Digit7,Digit8,Digit9,Digit0,Minus,Equal,X:Backspace',
		// Row D
		'4:Tab,KeyQ,KeyW,KeyE,KeyR,KeyT,KeyY,KeyU,KeyI,KeyO,KeyP,BracketLeft,BracketRight',
		// Row C
		'5:CapsLock,KeyA,KeyS,KeyD,KeyF,KeyG,KeyH,KeyJ,KeyK,KeyL,Semicolon,Quote,Backslash,X:Enter',
		// Row B
		'3.5:ShiftLeft,IntlBackslash,KeyZ,KeyX,KeyC,KeyV,KeyB,KeyN,KeyM,Comma,Period,Slash,X:ShiftRight',
		// Row A
		'4:ControlLeft,MetaLeft,AltLeft,21:Space,AltRight,MetaRight,ContextMenu,X:ControlRight',

		// Row K
		'Escape,-1:$space,F1,F2,F3,F4,-1:$space,F5,F6,F7,F8,-1:$space,F9,F10,F11,F12',

		// Control Pad E
		'Insert,Home,PageUp',
		// Control Pad D
		'Delete,End,PageDown',

		// Arrow Pad B
		'$space,ArrowUp,$space',
		// Arrow Pad A
		'ArrowLeft,ArrowDown,ArrowRight',
	])
}

export const KeyboardPreview = withTracker<IProps, IState, ITrackedProps>((props: IProps) => {
	const registered = RegisteredHotkeys.find().fetch()

	const parsed: ParsedHotkeyAssignments = {}
	
	registered.forEach(hotkey => {
		const modifiers: string[] = []

		const allKeys = hotkey.combo.toLowerCase().split('+')
		while (allKeys.length > 1) {
			modifiers.push(allKeys.shift()!)
		}

		const parsedHotkey: IHotkeyAssignmentExtended = Object.assign({}, hotkey, {
			finalKey: allKeys.shift()!
		})

		const modifiersKey = modifiers.join(' ')

		if (parsed[modifiersKey] === undefined) {
			parsed[modifiersKey] = []
		}

		parsed[modifiersKey].push(parsedHotkey)
	})

	console.log(parsed)

	return {
		hotkeys: parsed
	}
})(class KeyboardPreview extends MeteorReactComponent<IProps & ITrackedProps, IState> {
	constructor(props: IProps) {
		super(props)

		this.state = {
			layout: undefined,
			keyDown: {}
		}
	}

	onKeyUp = (e: KeyboardEvent) => {
		const keyDown = {}
		keyDown[e.code] = false

		if (this.state.keyDown[e.code] !== keyDown[e.code]) {
			this.setState({
				keyDown: Object.assign({}, this.state.keyDown, keyDown)
			})
		}
	}

	onKeyDown = (e: KeyboardEvent) => {
		const keyDown = {}
		keyDown[e.code] = true
		
		if (this.state.keyDown[e.code] !== keyDown[e.code]) {
			this.setState({
				keyDown: Object.assign({}, this.state.keyDown, keyDown)
			})
		}
	}

	onBlur = () => {
		this.setState({
			keyDown: {}
		})
	}

	onLayoutChange = () => {
		if (navigator.keyboard) {
			navigator.keyboard.getLayoutMap().then(layout => this.setState({ layout }))
		}
	}

	componentDidMount() {
		if (navigator.keyboard) {
			navigator.keyboard.getLayoutMap().then(layout => this.setState({ layout }))
			if (navigator.keyboard.addEventListener) {
				navigator.keyboard.addEventListener('layoutchange', this.onLayoutChange)
			}
		}
		window.addEventListener('keydown', this.onKeyDown)
		window.addEventListener('keyup', this.onKeyUp)
		window.addEventListener('blur', this.onBlur)
	}

	componentWillUnmount() {
		if (navigator.keyboard && navigator.keyboard.removeEventListener) {
			navigator.keyboard.removeEventListener('layoutchange', this.onLayoutChange)
		}
		window.removeEventListener('keydown', this.onKeyDown)
		window.removeEventListener('keyup', this.onKeyUp)
		window.removeEventListener('blur', this.onBlur)
	}

	private renderBlock(block: KeyPositon[][], modifiers: string) {
		return block.map((row, index) => <div className='keyboard-preview__key-row' key={index}>
			{ row.map((key, index) => {
				if (key.code === SpecialKeyPositions.BLANK_SPACE) {
					return <div key={'idx' + index} className={classNames('keyboard-preview__blank-space', {
						'keyboard-preview__blank-space--spring': (key.width < 0)
					})} style={{fontSize: key.width >= 0 ? (key.width || 1) + 'em' : undefined }}></div>
				} else {
					let func = this.props.hotkeys[modifiers] && this.props.hotkeys[modifiers].find(hotkey =>
						hotkey.finalKey === key.code.toLowerCase() ||
						(this.state.layout ?
							hotkey.finalKey === (this.state.layout.get(key.code) || '').toLowerCase() :
							false)
					)

					return <div key={key.code} className={classNames('keyboard-preview__key', {
						'keyboard-preview__key--fill': (key.width < 0),
						'keyboard-preview__key--down': this.state.keyDown[key.code] === true
					})} style={{fontSize: key.width >= 0 ? (key.width || 1) + 'em' : undefined }}>
							<div className='keyboard-preview__key__label'>
								{this.state.layout ?
									this.state.layout.get(key.code) || GenericFuncionalKeyLabels[key.code] || key.code :
									GenericFuncionalKeyLabels[key.code] || key.code
								}
							</div>
							{func && <div className='keyboard-preview__key__function-label'>
								{func.label}
							</div>}
						</div>
				}
			}) }
		</div>)
	}

	render() {
		const { physicalLayout: keys } = this.props
		const alphanumericBlock = keys.slice(0, 5)
		const functionBlock = keys.slice(5, 6)
		const controlPad = keys.slice(6, 8)
		const arrowPad = keys.slice(8, 10)
		const numPad = keys.slice(11, 15)

		const knownModifiers = [GenericFuncionalKeyLabels.AltLeft, GenericFuncionalKeyLabels.ShiftLeft, GenericFuncionalKeyLabels.ControlLeft]

		const currentModifiers = _.intersection(_.compact(
			_.map(this.state.keyDown, (value, key) => !!value ? key : undefined)
		).map(keyCode => {
			return this.state.layout ?
				this.state.layout.get(keyCode) || GenericFuncionalKeyLabels[keyCode] || keyCode :
				GenericFuncionalKeyLabels[keyCode] || keyCode
		}), knownModifiers).join(' ').toLowerCase()

		console.log(currentModifiers)

		return <div className='keyboard-preview'>
			{functionBlock.length > 0 && <div className='keyboard-preview__function'>
				{this.renderBlock(functionBlock, currentModifiers)}
			</div>}
			{alphanumericBlock.length > 0 && <div className='keyboard-preview__alphanumeric'>
				{this.renderBlock(alphanumericBlock, currentModifiers)}
			</div>}
			{controlPad.length > 0 && <div className='keyboard-preview__control-pad'>
				{this.renderBlock(controlPad, currentModifiers)}
			</div>}
			{arrowPad.length > 0 && <div className='keyboard-preview__arrow-pad'>
				{this.renderBlock(arrowPad, currentModifiers)}
			</div>}
			{numPad.length > 0 && <div className='keyboard-preview__num-pad'>
				{this.renderBlock(numPad, currentModifiers)}
			</div>}
		</div>
	}
})
