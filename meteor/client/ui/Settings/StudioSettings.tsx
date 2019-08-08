import * as ClassNames from 'classnames'
import * as React from 'react'
import { Meteor } from 'meteor/meteor'
import * as _ from 'underscore'
import {
	Studio,
	Studios,
	MappingExt
} from '../../../lib/collections/Studios'
import {
	MappingAtemType,
	MappingLawoType,
	MappingPanasonicPtzType,
	MappingHyperdeckType,
	DeviceType as PlayoutDeviceType,
	ChannelFormat,
	QuantelControlMode
} from 'timeline-state-resolver-types'
import { EditAttribute, EditAttributeBase } from '../../lib/EditAttribute'
import { doModalDialog } from '../../lib/ModalDialog'
import { Translated, translateWithTracker } from '../../lib/ReactMeteorData/react-meteor-data'
import { Spinner } from '../../lib/Spinner'
import * as faTrash from '@fortawesome/fontawesome-free-solid/faTrash'
import * as faPencilAlt from '@fortawesome/fontawesome-free-solid/faPencilAlt'
import * as faCheck from '@fortawesome/fontawesome-free-solid/faCheck'
import * as faPlus from '@fortawesome/fontawesome-free-solid/faPlus'
import * as FontAwesomeIcon from '@fortawesome/react-fontawesome'
import { PeripheralDevice, PeripheralDevices } from '../../../lib/collections/PeripheralDevices'

import { Link } from 'react-router-dom'
import { MomentFromNow } from '../../lib/Moment'
import { MeteorReactComponent } from '../../lib/MeteorReactComponent'
import { ShowStyleVariants, ShowStyleVariant } from '../../../lib/collections/ShowStyleVariants'
import { translate } from 'react-i18next'
import { ShowStyleBases, ShowStyleBase, } from '../../../lib/collections/ShowStyleBases'
import { LookaheadMode, BlueprintManifestType } from 'tv-automation-sofie-blueprints-integration'
import { ConfigManifestSettings, collectConfigs } from './ConfigManifestSettings'
import { Blueprints } from '../../../lib/collections/Blueprints'
import { PlayoutAPI } from '../../../lib/api/playout'
import {
	mappingIsAbstract,
	mappingIsCasparCG,
	mappingIsAtem,
	mappingIsLawo,
	mappingIsPanasonicPtz,
	mappingIsHTTPSend,
	mappingIsHyperdeck,
	mappingIsPharos,
	mappingIsOSC,
	mappingIsQuantel,
	mappingIsSisyfos
} from '../../../lib/api/studios'

interface IStudioDevicesProps {
	studio: Studio
	studioDevices: Array<PeripheralDevice>
	availableDevices: Array<PeripheralDevice>
}
interface IStudioDevicesSettingsState {
	showAvailableDevices: boolean
}
const StudioDevices = translate()(class StudioDevices extends React.Component<Translated<IStudioDevicesProps>, IStudioDevicesSettingsState> {
	constructor (props: Translated<IStudioDevicesProps>) {
		super(props)

		this.state = {
			showAvailableDevices: false,
		}
	}

	onRemoveDevice = (item: PeripheralDevice) => {
		PeripheralDevices.update(item._id, {$unset: {
			studioId: 1
		}})
	}

	onAddDevice = (item: PeripheralDevice) => {
		PeripheralDevices.update(item._id, {$set: {
			studioId: this.props.studio._id
		}})
	}
	confirmRemove = (device: PeripheralDevice) => {
		const { t } = this.props
		doModalDialog({
			title: t('Remove this device?'),
			yes: t('Remove'),
			no: t('Cancel'),
			onAccept: () => {
				this.onRemoveDevice(device)
			},
			message: <p>{t('Are you sure you want to remove device "{{deviceId}}"?', { deviceId: device && (device.name || device._id) })}</p>
		})
	}

	renderDevices () {
		return (
			this.props.studioDevices.map((device, index) => {
				return <tr key={device._id}>
							<th className='settings-studio-device__name c3'>
								<Link to={'/settings/peripheralDevice/' + device._id}>{device.name}</Link>
							</th>
							<td className='settings-studio-device__id c3'>
								{device._id}
							</td>
							<td className='settings-studio-device__id c3'>
								<MomentFromNow date={device.lastSeen} />
							</td>
							<td className='settings-studio-device__actions table-item-actions c3'>
								<button className='action-btn' onClick={(e) => this.confirmRemove(device)}>
									<FontAwesomeIcon icon={faTrash} />
								</button>
							</td>
						</tr>
			})
		)
	}

	showAvailableDevices () {
		this.setState({
			showAvailableDevices: !this.state.showAvailableDevices
		})
	}

	render () {
		const { t } = this.props
		return (
			<div>
				<h2 className='mhn'>{t('Attached Devices')}</h2>
				<table className='expando settings-studio-device-table'>
					<tbody>
						{this.renderDevices()}
					</tbody>
				</table>
				<div className='mod mhs'>
					<button className='btn btn-primary' onClick={(e) => this.showAvailableDevices()}>
						<FontAwesomeIcon icon={faPlus} />
					</button>
					{ this.state.showAvailableDevices &&
						<div className='border-box text-s studio-devices-dropdown'>
							<div className='ctx-menu'>
								{
									this.props.availableDevices.map((device) => {
										return (
											<div className='ctx-menu-item' key={device._id} onClick={(e) => this.onAddDevice(device)}>
												<b>{device.name}</b> <MomentFromNow date={device.lastSeen} /> ({device._id})
											</div>
										)
									})
								}
							</div>
						</div>
					}
				</div>
			</div>
		)
	}
})

interface IStudioMappingsProps {
	studio: Studio
}
interface IStudioMappingsState {
	editedMappings: Array<string>
}

const StudioMappings = translate()(class StudioMappings extends React.Component<Translated<IStudioMappingsProps>, IStudioMappingsState> {
	constructor (props: Translated<IStudioMappingsProps>) {
		super(props)

		this.state = {
			editedMappings: []
		}
	}
	isItemEdited = (layerId: string) => {
		return this.state.editedMappings.indexOf(layerId) >= 0
	}
	finishEditItem = (layerId: string) => {
		let index = this.state.editedMappings.indexOf(layerId)
		if (index >= 0) {
			this.state.editedMappings.splice(index, 1)
			this.setState({
				editedMappings: this.state.editedMappings
			})
		}
	}
	editItem = (layerId: string) => {
		if (this.state.editedMappings.indexOf(layerId) < 0) {
			this.state.editedMappings.push(layerId)
			this.setState({
				editedMappings: this.state.editedMappings
			})
		}
	}
	confirmRemove = (mappingId: string) => {
		const { t } = this.props
		doModalDialog({
			title: t('Remove this mapping?'),
			yes: t('Remove'),
			no: t('Cancel'),
			onAccept: () => {
				this.removeLayer(mappingId)
			},
			message: <React.Fragment>
				<p>{t('Are you sure you want to remove mapping for layer "{{mappingId}}"?', { mappingId: mappingId })}</p>
				<p>{t('Please note: This action is irreversible!')}</p>
			</React.Fragment>
		})
	}
	removeLayer = (mappingId: string) => {
		let unsetObject = {}
		unsetObject['mappings.' + mappingId] = ''
		Studios.update(this.props.studio._id, {
			$unset: unsetObject
		})
	}
	addNewLayer = () => {
		// find free key name
		let newLayerKeyName = 'newLayer'
		let iter = 0
		while ((this.props.studio.mappings || {})[newLayerKeyName + iter.toString()]) {
			iter++
		}
		let setObject = {}
		setObject['mappings.' + newLayerKeyName + iter.toString()] = {
			device: PlayoutDeviceType.CASPARCG,
			deviceId: 'newDeviceId',
		}

		Studios.update(this.props.studio._id, {
			$set: setObject
		})
	}
	updateLayerId = (edit: EditAttributeBase, newValue: string) => {

		let oldLayerId = edit.props.overrideDisplayValue
		let newLayerId = newValue + ''
		let layer = this.props.studio.mappings[oldLayerId]

		if (this.props.studio.mappings[newLayerId]) {
			throw new Meteor.Error(400, 'Layer "' + newLayerId + '" already exists')
		}

		let mSet = {}
		let mUnset = {}
		mSet['mappings.' + newLayerId] = layer
		mUnset['mappings.' + oldLayerId] = 1

		if (edit.props.collection) {
			edit.props.collection.update(this.props.studio._id, {
				$set: mSet,
				$unset: mUnset
			})
		}

		this.finishEditItem(oldLayerId)
		this.editItem(newLayerId)
	}

	renderCaparCGMappingSettings (layerId: string) {
		const { t } = this.props
		return (
			<React.Fragment>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('CasparCG Channel')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.channel'}
							obj={this.props.studio}
							type='int'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
						<i>{t('The CasparCG channel to use (1 is the first)')}</i>
					</label>
				</div>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('CasparCG Layer')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.layer'}
							obj={this.props.studio}
							type='int'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
						<i>{t('The layer in a channel to use')}</i>
					</label>
				</div>
			</React.Fragment>
		)
	}

	renderAtemMappingSettings (layerId: string) {
		const { t } = this.props
		return (
			<React.Fragment>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Mapping type')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.mappingType'}
							obj={this.props.studio}
							type='dropdown'
							options={MappingAtemType}
							optionsAreNumbers={true}
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Index')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.index'}
							obj={this.props.studio}
							type='int'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
			</React.Fragment>
		)
	}
	renderLawoMappingSettings (layerId: string) {
		const { t } = this.props
		return (
			<React.Fragment>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Mapping type')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.mappingType'}
							obj={this.props.studio}
							type='dropdown'
							options={MappingLawoType}
							optionsAreNumbers={true}
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Identifier')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.identifier'}
							obj={this.props.studio}
							type='text'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
			</React.Fragment>
		)
	}
	renderPanasonicPTZSettings (layerId: string) {
		const { t } = this.props
		return (
			<React.Fragment>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Mapping type')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.mappingType'}
							obj={this.props.studio}
							type='dropdown'
							options={MappingPanasonicPtzType}
							optionsAreNumbers={false}
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
			</React.Fragment>
		)
	}

	renderHyperdeckMappingSettings (layerId: string) {
		const { t } = this.props
		return (
			<React.Fragment>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Mapping type')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.mappingType'}
							obj={this.props.studio}
							type='dropdown'
							options={MappingHyperdeckType}
							optionsAreNumbers={false}
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
			</React.Fragment>
		)
	}
	renderPharosMappingSettings (layerId: string) {
		return (
			<React.Fragment>
				<div></div>
			</React.Fragment>
		)
	}
	renderSisyfosMappingSettings (layerId: string) {
		const { t } = this.props

		return (
			<React.Fragment>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('QuanSisyfos Channel')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.channel'}
							obj={this.props.studio}
							type='int'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
			</React.Fragment>
		)
	}
	renderQuantelMappingSettings (layerId: string) {
		const { t } = this.props

		return (
			<React.Fragment>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Quantel Port ID')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.portId'}
							obj={this.props.studio}
							type='text'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
						<i>{t('The name you\'d like the port to have')}</i>
					</label>
				</div>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Quantel Channel ID')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.channelId'}
							obj={this.props.studio}
							type='int'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
						<i>{t('The channel to use for output (0 is the first one)')}</i>
					</label>
				</div>
				<div className='mod mvs mhs'>
					<label className='field'>
						{t('Mode')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute={'mappings.' + layerId + '.mode'}
							obj={this.props.studio}
							type='dropdown'
							options={QuantelControlMode}
							optionsAreNumbers={false}
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
			</React.Fragment>
		)
	}

	renderMappings () {
		const { t } = this.props

		return (
			_.map(this.props.studio.mappings, (mapping: MappingExt , layerId: string) => {
				// If an internal mapping, then hide it
				if (mapping.internal) return <React.Fragment key={layerId}></React.Fragment>

				return <React.Fragment key={layerId}>
					<tr className={ClassNames({
						'hl': this.isItemEdited(layerId)
					})}>
						<th className='settings-studio-device__name c3'>
							{layerId}
						</th>
						<td className='settings-studio-device__id c2'>
							{PlayoutDeviceType[mapping.device]}
						</td>
						<td className='settings-studio-device__id c2'>
							{mapping.deviceId}
						</td>
						<td className='settings-studio-device__id c4'>
						{
							(
								mappingIsAbstract(mapping) && (
								<span>-</span>
							)) ||
							(
								mappingIsCasparCG(mapping) && (
								<span>{ mapping.channel } - { mapping.layer }</span>
							)) ||
							(
								mappingIsAtem(mapping) && (
								<span>{ MappingAtemType[mapping.mappingType] } { mapping.index }</span>
							)) ||
							(
								mappingIsLawo(mapping) && (
								<span>{ MappingLawoType[mapping.mappingType] } { mapping.identifier }</span>
							)) ||
							(
								mappingIsPanasonicPtz(mapping) && (
									<span>{
										mapping.mappingType === MappingPanasonicPtzType.PRESET ? t('Preset') :
										mapping.mappingType === MappingPanasonicPtzType.PRESET_SPEED ? t('Preset Transition Speed') :
										mapping.mappingType === MappingPanasonicPtzType.ZOOM ? t('Zoom') :
										mapping.mappingType === MappingPanasonicPtzType.ZOOM_SPEED ? t('Zoom Speed') :
										t('Unknown Mapping')
									}</span>
							)) ||
							(
								mappingIsHTTPSend(mapping) && (
								<span>-</span>
							)) ||
							(
								mappingIsHyperdeck(mapping) && (
								<span>{ mapping.mappingType }</span>
							)) ||
							(
								mappingIsPharos(mapping) && (
								<span>-</span>
							)) ||
							(
								mappingIsOSC(mapping) && (
								<span>-</span>
							)) ||
							(
								mappingIsSisyfos(mapping) && (
									<span>{t('Channel: {{channel}}', { channel: mapping.channel })}</span>
							)) ||
							(
								mappingIsQuantel(mapping) && (
									<span>{t('Port: {{port}}, Channel: {{channel}}', { port: mapping.portId, channel: mapping.channelId })}</span>
							)) ||
							(
								<span>{t('Unknown device type: {{device}}', { device: PlayoutDeviceType[mapping.device] }) } </span>
							)
						}
						</td>

						<td className='settings-studio-device__actions table-item-actions c3'>
							<button className='action-btn' onClick={(e) => this.editItem(layerId)}>
								<FontAwesomeIcon icon={faPencilAlt} />
							</button>
							<button className='action-btn' onClick={(e) => this.confirmRemove(layerId)}>
								<FontAwesomeIcon icon={faTrash} />
							</button>
						</td>
					</tr>
					{this.isItemEdited(layerId) &&
						<tr className='expando-details hl'>
							<td colSpan={5}>
								<div>
									<div className='mod mvs mhs'>
										<label className='field'>
											{t('Layer ID')}
											<EditAttribute
												modifiedClassName='bghl'
												attribute={'mappings' }
												overrideDisplayValue={layerId }
												obj={this.props.studio}
												type='text'
												collection={Studios}
												updateFunction={this.updateLayerId}
												className='input text-input input-l'></EditAttribute>
											<i>{t('ID of the timeline-layer to map to some output')}</i>
										</label>
									</div>
									<div className='mod mvs mhs'>
										<label className='field'>
											{t('Device Type')}
											<EditAttribute
												modifiedClassName='bghl'
												attribute={'mappings.' + layerId + '.device'}
												obj={this.props.studio}
												type='dropdown'
												options={PlayoutDeviceType}
												optionsAreNumbers={true}
												collection={Studios}
												className='input text-input input-l'></EditAttribute>
											<i>{t('The type of device to use for the output')}</i>
										</label>
									</div>
									<div className='mod mvs mhs'>
										<label className='field'>
											{t('Device ID')}
											<EditAttribute
												modifiedClassName='bghl'
												attribute={'mappings.' + layerId + '.deviceId'}
												obj={this.props.studio}
												type='text'
												collection={Studios}
												className='input text-input input-l'></EditAttribute>
											<i>{t('ID of the device (corresponds to the device ID in the peripheralDevice settings)')}</i>
										</label>
									</div>
									<div className='mod mvs mhs'>
										<label className='field'>
											{t('Lookahead Mode')}
											<EditAttribute
												modifiedClassName='bghl'
												attribute={'mappings.' + layerId + '.lookahead'}
												obj={this.props.studio}
												type='dropdown'
												options={LookaheadMode}
												optionsAreNumbers={true}
												collection={Studios}
												className='input text-input input-l'></EditAttribute>
										</label>
									</div>
									{(
										mappingIsCasparCG(mapping) && (
											this.renderCaparCGMappingSettings(layerId)
										) ||
										(
										mappingIsAtem(mapping) && (
											this.renderAtemMappingSettings(layerId)
										))
										) ||
										(
										mappingIsLawo(mapping) && (
											this.renderLawoMappingSettings(layerId)
										)) ||
										(
										mappingIsPanasonicPtz(mapping) && (
											this.renderPanasonicPTZSettings(layerId)
										)) ||
										(
										mappingIsHyperdeck(mapping) && (
											this.renderHyperdeckMappingSettings(layerId)
										)) ||
										(
										mappingIsPharos(mapping) && (
											this.renderPharosMappingSettings(layerId)
										)) ||
										(
										mappingIsSisyfos(mapping) && (
											this.renderSisyfosMappingSettings(layerId))) ||
										(
										mappingIsQuantel(mapping) && (
											this.renderQuantelMappingSettings(layerId)
										))
									}
								</div>
								<div className='mod alright'>
									<button className={ClassNames('btn btn-primary')} onClick={(e) => this.finishEditItem(layerId)}>
										<FontAwesomeIcon icon={faCheck} />
									</button>
								</div>
							</td>
						</tr>
					}
				</React.Fragment>
			})
		)
	}

	render () {
		const { t } = this.props
		return (
			<div>
				<h2 className='mhn'>{t('Layer Mappings')}</h2>
				<table className='expando settings-studio-mappings-table'>
					<tbody>
						{this.renderMappings()}
					</tbody>
				</table>
				<div className='mod mhs'>
					<button className='btn btn-primary' onClick={(e) => this.addNewLayer()}>
						<FontAwesomeIcon icon={faPlus} />
					</button>
				</div>
			</div>
		)
	}
})

interface ITestToolsRecordingsSettingsProps {
	studio: Studio
}
interface ITestToolsRecordingsSettingsState {
}

const TestToolsRecordingsSettings = translate()(class TestToolsRecordingsSettings extends React.Component<Translated<ITestToolsRecordingsSettingsProps>, ITestToolsRecordingsSettingsState> {
	render () {
		const { t } = this.props
		return (
			<div>
				<h2 className='mhn'>{t('Test Tools – Recordings')}</h2>
				<div className='mod mvs mhn'>
					<label className='field'>
						{t('Device ID')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute='testToolsConfig.recordings.deviceId'
							obj={this.props.studio}
							type='text'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
				<div className='mod mvs mhn'>
					<label className='field'>
						{t('CasparCG Channel')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute='testToolsConfig.recordings.channelIndex'
							obj={this.props.studio}
							type='int'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
				<div className='mod mvs mhn'>
					<label className='field'>
						{t('Path Prefix')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute='testToolsConfig.recordings.filePrefix'
							obj={this.props.studio}
							type='text'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
				<div className='mod mvs mhn'>
					<label className='field'>
						{t('URL Prefix')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute='testToolsConfig.recordings.urlPrefix'
							obj={this.props.studio}
							type='text'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
				<div className='mod mvs mhn'>
					<label className='field'>
						{t('Decklink Input Index')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute='testToolsConfig.recordings.decklinkDevice'
							obj={this.props.studio}
							type='int'
							collection={Studios}
							className='input text-input input-l'></EditAttribute>
					</label>
				</div>
				<div className='mod mvs mhn'>
					<label className='field'>
						{t('Decklink Input Format')}
						<EditAttribute
							modifiedClassName='bghl'
							attribute='testToolsConfig.recordings.channelFormat'
							obj={this.props.studio}
							type='dropdown'
							options={_.keys(ChannelFormat).map((k) => ({
								name: k,
								value: ChannelFormat[k]
							}))}
							collection={Studios}
							className='input text-input input-l '></EditAttribute>
					</label>
				</div>
			</div>
		)
	}
})

interface IStudioSettingsProps {
	match: {
		params: {
			studioId: string
		}
	}
}
interface IStudioSettingsState {

}
interface IStudioSettingsTrackedProps {
	studio?: Studio
	studioDevices: Array<PeripheralDevice>
	availableShowStyleVariants: Array<{
		name: string,
		value: string,
		showStyleVariant: ShowStyleVariant
	}>
	availableShowStyleBases: Array<{
		name: string,
		value: string
		showStyleBase: ShowStyleBase
	}>
	availableDevices: Array<PeripheralDevice>
}

interface IStudioBaselineStatusProps {
	studio: Studio
}
interface IStudioBaselineStatusState {
	needsUpdate: boolean
}

class StudioBaselineStatus extends MeteorReactComponent<Translated<IStudioBaselineStatusProps>, IStudioBaselineStatusState> {
	private updateInterval: number | undefined = undefined

	constructor (props: Translated<IStudioBaselineStatusProps>) {
		super(props)

		this.state = {
			needsUpdate: false
		}
	}

	componentDidMount () {
		const updatePeriod = 30000 // every 30s
		this.updateInterval = Meteor.setInterval(() => this.updateStatus(), updatePeriod)
		this.updateStatus()
	}

	componentWillUnmount () {
		if (this.updateInterval) {
			Meteor.clearInterval(this.updateInterval)
			this.updateInterval = undefined
		}
	}

	componentDidUpdate () {
		this.updateStatus(this.props)
	}

	updateStatus (props?: Translated<IStudioBaselineStatusProps>) {
		const studio = props ? props.studio : this.props.studio

		Meteor.call(PlayoutAPI.methods.shouldUpdateStudioBaseline, studio._id, (err, res) => {
			if (err) {
				console.log('Failed to update studio baseline status: ' + err)
				res = false
			}

			if (this.updateInterval) {
				this.setState({
					needsUpdate: !!res
				})
			}
		})
	}

	reloadBaseline () {
		Meteor.call(PlayoutAPI.methods.updateStudioBaseline, this.props.studio._id, (err, res) => {
			if (err) {
				console.log('Failed to update studio baseline: ' + err)
				res = false
			}

			if (this.updateInterval) {
				this.setState({
					needsUpdate: !!res
				})
			}
		})
	}

	render () {
		const { t } = this.props
		const { needsUpdate } = this.state

		return <div>
			<p className='mhn'>{t('Studio Baseline needs update: ')} {needsUpdate ? t('Yes') : t('No')}</p>
			<p className='mhn'><button className='btn btn-primary' onClick={(e) => this.reloadBaseline()}>{t('Reload Baseline')}</button></p>
		</div>
	}
}

export default translateWithTracker<IStudioSettingsProps, IStudioSettingsState, IStudioSettingsTrackedProps>((props: IStudioSettingsProps, state) => {
	const studio = Studios.findOne(props.match.params.studioId)

	return {
		studio: studio,
		studioDevices: PeripheralDevices.find({
			studioId: props.match.params.studioId
		}).fetch(),
		availableShowStyleVariants: ShowStyleVariants.find(studio ? {
			showStyleBaseId: {
				$in: studio.supportedShowStyleBase || []
			}
		} : {}).fetch().map((variant) => {
			const baseStyle = ShowStyleBases.findOne(variant.showStyleBaseId)
			return {
				name: `${(baseStyle || { name: '' }).name}: ${variant.name} (${variant._id})`,
				value: variant._id,
				showStyleVariant: variant
			}
		}),
		availableShowStyleBases: ShowStyleBases.find().fetch().map((showStyle) => {
			return {
				name: `${showStyle.name}`,
				value: showStyle._id,
				showStyleBase: showStyle
			}
		}),
		availableDevices: PeripheralDevices.find({
			studioId: {
				$not: {
					$eq: props.match.params.studioId
				}
			},
			parentDeviceId: {
				$exists: false
			}
		}, {
			sort: {
				lastConnected: -1
			}
		}).fetch()
	}
})(class StudioSettings extends MeteorReactComponent<Translated<IStudioSettingsProps & IStudioSettingsTrackedProps>, IStudioSettingsState> {
	getBlueprintOptions () {
		const { t } = this.props

		let options: { name: string, value: string | null }[] = [{
			name: t('None'),
			value: '',
		}]

		options.push(..._.map(Blueprints.find({ blueprintType: BlueprintManifestType.STUDIO }).fetch(), (blueprint) => {
			return {
				name: blueprint.name ? blueprint.name + ` (${blueprint._id})` : blueprint._id,
				value: blueprint._id
			}
		}))

		return options
	}

	renderEditForm () {
		const { t } = this.props

		return (
			this.props.studio ?
			<div className='studio-edit mod mhl mvn'>
				<div>
					<h2 className='mhn mtn'>{t('Generic Properties')}</h2>
					<label className='field'>
						{t('Studio Name')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='name'
								obj={this.props.studio}
								type='text'
								collection={Studios}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>
					<label className='field'>
						{t('Blueprint')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='blueprintId'
								obj={this.props.studio}
								type='dropdown'
								options={this.getBlueprintOptions()}
								mutateDisplayValue={v => v || ''}
								mutateUpdateValue={v => v === '' ? undefined : v}
								collection={Studios}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>
					<div className='field'>
						{t('Select Compatible Show Styles')}
						<div className='mdi'>
							<EditAttribute
								attribute='supportedShowStyleBase'
								obj={this.props.studio}
								options={this.props.availableShowStyleBases}
								label={t('Click to show available Show Styles')}
								type='multiselect'
								collection={Studios}></EditAttribute>
						</div>
					</div>
					<label className='field'>
						{t('Media Preview URL')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='settings.mediaPreviewsUrl'
								obj={this.props.studio}
								type='text'
								collection={Studios}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>
					<label className='field'>
						{t('Sofie Host URL')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='settings.sofieUrl'
								obj={this.props.studio}
								type='text'
								collection={Studios}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>
					<label className='field'>
						{t('Slack Webhook URLs')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='settings.slackEvaluationUrls'
								obj={this.props.studio}
								type='text'
								collection={Studios}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>
					<label className='field'>
						{t('Supported Media Formats')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='settings.supportedMediaFormats'
								obj={this.props.studio}
								type='text'
								collection={Studios}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>
					<label className='field'>
						{t('Supported Audio Formats')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='settings.supportedAudioStreams'
								obj={this.props.studio}
								type='text'
								collection={Studios}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>
				</div>
				<div className='row'>
					<div className='col c12 r1-c12'>
						<StudioBaselineStatus studio={this.props.studio} t={t} />
					</div>
				</div>
				<div className='row'>
					<div className='col c12 r1-c12'>
						<StudioDevices
							studio={this.props.studio}
							studioDevices={this.props.studioDevices}
							availableDevices={this.props.availableDevices}
						/>
					</div>
				</div>
				<div className='row'>
					<div className='col c12 r1-c12'>
						<ConfigManifestSettings
							t={this.props.t}
							manifest={collectConfigs(this.props.studio)}
							object={this.props.studio}
							collection={Studios}
							configPath={'config'}
							/>
					</div>
				</div>
				<div className='row'>
					<div className='col c12 r1-c12'>
						<StudioMappings studio={this.props.studio} />
					</div>
				</div>
				<div className='row'>
					<div className='col c12 r1-c12'>
						<TestToolsRecordingsSettings studio={this.props.studio} />
					</div>
				</div>
			</div> :
			<Spinner />
		)
	}

	render () {

		if (this.props.studio) {
			return this.renderEditForm()
		} else {
			return <Spinner />
		}
	}
})

export function setProperty (studio: Studio, property: string, value: any) {
	// console.log(property, value)
	let m = {}
	if (value !== undefined) {
		m[property] = value
		Studios.update(studio._id, { $set: m })
	} else {
		m[property] = 0
		Studios.update(studio._id, { $unset: m })
	}
}

export function findHighestRank (array: Array<{ _rank: number }>): { _rank: number } | null {
	let max: { _rank: number } | null = null

	array.forEach((value, index) => {
		if (max === null || max._rank < value._rank) {
			max = value
		}
	})

	return max
}
