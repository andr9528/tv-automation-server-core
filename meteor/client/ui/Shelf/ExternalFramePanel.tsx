import * as React from 'react'
import { Random } from 'meteor/random'
import * as _ from 'underscore'
import { RundownLayoutExternalFrame, RundownLayoutBase, DashboardLayoutExternalFrame } from '../../../lib/collections/RundownLayouts'
import { RundownLayoutsAPI } from '../../../lib/api/rundownLayouts'
import { dashboardElementPosition } from './DashboardPanel'
import { literal } from '../../../lib/lib'
import { Rundown } from '../../../lib/collections/Rundowns'

const PackageInfo = require('../../../package.json')

interface IProps {
	layout: RundownLayoutBase
	panel: RundownLayoutExternalFrame
	visible: boolean
	rundown: Rundown
}

enum SofieExternalMessageType {
	HELLO = 'hello',
	WELCOME = 'welcome',
	ACK = 'ack',
	NAK = 'nak',
	KEYBOARD_EVENT = 'keyboard_event',
	CURRENT_PART_CHANGED = 'current_part_changed',
	NEXT_PART_CHANGED = 'next_part_changed'
}

interface SofieExternalMessage {
	id: string,
	replyToId?: string
	type: SofieExternalMessageType
	payload?: any
}

interface HelloSofieExternalMessage extends SofieExternalMessage {
	type: SofieExternalMessageType.HELLO
	payload: never
}

interface WelcomeSofieExternalMessage extends SofieExternalMessage {
	type: SofieExternalMessageType.WELCOME
	payload: {
		host: string
		version: string
		rundownId: string
	}
}

interface KeyboardEventSofieExternalMessage extends SofieExternalMessage {
	type: SofieExternalMessageType.KEYBOARD_EVENT
	payload: KeyboardEvent & {
		currentTarget: null,
		path: null,
		scrElement: null,
		target: null,
		view: null
	}
}

interface CurrentNextPartChangedSofieExternalMessage extends SofieExternalMessage {
	type: SofieExternalMessageType.CURRENT_PART_CHANGED | SofieExternalMessageType.NEXT_PART_CHANGED
	payload: {
		partId: string | null
		prevPartId?: string | null
	}
}

export class ExternalFramePanel extends React.Component<IProps> {
	frame: HTMLIFrameElement
	mounted: boolean = false
	initialized: boolean = false

	awaitingReply: {
		[key: string]: {
			resolve: Function
			reject: Function
		}
	} = {}

	setElement = (frame: HTMLIFrameElement) => {
		this.frame = frame
		if (this.frame && !this.mounted) {
			this.registerHandlers()
			this.mounted = true
		} else {
			this.unregisterHandlers()
			this.mounted = false
		}
	}

	onKeyEvent = (e: KeyboardEvent) => {
		this.sendMessage(literal<SofieExternalMessage>({
			id: Random.id(),
			type: SofieExternalMessageType.KEYBOARD_EVENT,
			// Send the event sanitized to prevent sending huge objects
			payload: _.extend({}, e, {
				currentTarget: null,
				path: null,
				srcElement: null,
				target: null,
				view: null
			})
		}))
	}

	onReceiveMessage = (e: MessageEvent) => {
		if (e.origin === this.props.panel.url) {
			try {
				const data = JSON.parse(e.data || e['message'])
				this.actMessage(data)
			} catch (e) {
				console.error(`ExternalFramePanel: Unable to parse data from: ${e.origin}`, e)
			}
		}
	}

	actMessage = (message: SofieExternalMessage) => {
		if (!message.type || SofieExternalMessageType[message.type] === undefined) {
			console.error(`ExternalFramePanel: Unknown message type: ${message.type}`)
			return
		}

		if (message.replyToId && this.awaitingReply[message.replyToId]) {
			this.awaitingReply[message.replyToId].resolve(message)
			delete this.awaitingReply[message.replyToId]
			return
		}

		switch (message.type) {
			// perform a three-way handshake: HELLO -> WELCOME -> ACK
			case SofieExternalMessageType.HELLO:
				this.sendMessageAwaitReply(literal<WelcomeSofieExternalMessage>({
					id: Random.id(),
					replyToId: message.id,
					type: SofieExternalMessageType.WELCOME,
					payload: {
						host: 'Sofie Automation System',
						version: PackageInfo.version,
						rundownId: this.props.rundown._id
					}
				})).then((e) => {
					if (e.type === SofieExternalMessageType.ACK) {
						this.initialized = true
						this.sendCurrentState()
					}
				})
				break;
		}
	}

	sendMessageAwaitReply = (message: SofieExternalMessage): Promise<SofieExternalMessage> => {
		return new Promise((resolve, reject) => {
			this.awaitingReply[message.id] = { resolve, reject }
			this.sendMessage(message)
		})
	}

	sendMessage = (data: SofieExternalMessage) => {
		if (this.frame && this.frame.contentWindow && this.initialized) {
			this.frame.contentWindow.postMessage(JSON.stringify(data), "*")
		}
	}

	sendCurrentState () {
		this.sendMessage(literal<CurrentNextPartChangedSofieExternalMessage>({
			id: Random.id(),
			type: SofieExternalMessageType.CURRENT_PART_CHANGED,
			payload: {
				partId: this.props.rundown.currentPartId
			}
		}))
		this.sendMessage(literal<CurrentNextPartChangedSofieExternalMessage>({
			id: Random.id(),
			type: SofieExternalMessageType.NEXT_PART_CHANGED,
			payload: {
				partId: this.props.rundown.nextPartId
			}
		}))
	}

	registerHandlers = () => {
		document.addEventListener('keydown', this.onKeyEvent)
		document.addEventListener('keyup', this.onKeyEvent)
	}

	unregisterHandlers = () => {
		document.removeEventListener('keydown', this.onKeyEvent)
		document.removeEventListener('keydown', this.onKeyEvent)
	}

	componentDidUpdate (prevProps: IProps) {
		if (prevProps.rundown.currentPartId !== this.props.rundown.currentPartId) {
			this.sendMessage(literal<CurrentNextPartChangedSofieExternalMessage>({
				id: Random.id(),
				type: SofieExternalMessageType.CURRENT_PART_CHANGED,
				payload: {
					partId: this.props.rundown.currentPartId,
					prevPartId: prevProps.rundown.currentPartId
				}
			}))
		}

		if (prevProps.rundown.nextPartId !== this.props.rundown.nextPartId) {
			this.sendMessage(literal<CurrentNextPartChangedSofieExternalMessage>({
				id: Random.id(),
				type: SofieExternalMessageType.NEXT_PART_CHANGED,
				payload: {
					partId: this.props.rundown.nextPartId,
					prevPartId: prevProps.rundown.nextPartId
				}
			}))
		}
	}

	componentDidMount () {
		window.addEventListener('message', this.onReceiveMessage)
	}

	componentWillUnmount () {
		// reject all outstanding promises for replies
		_.each(this.awaitingReply, (promise) => promise.reject())
		this.unregisterHandlers()
		window.removeEventListener('message', this.onReceiveMessage)
	}

	render () {
		return <div className='external-frame-panel'
			style={
				_.extend(
					RundownLayoutsAPI.isDashboardLayout(this.props.layout) ?
						dashboardElementPosition(this.props.panel as DashboardLayoutExternalFrame) :
						{},
					{
						'visibility': this.props.visible ? 'visible' : 'hidden'
					}
				)
			}>
			<iframe
			ref={this.setElement}
			className='external-frame-panel__iframe'
			src={this.props.panel.url}
			sandbox='allow-forms allow-popups allow-scripts'></iframe>
		</div> 
	}
}