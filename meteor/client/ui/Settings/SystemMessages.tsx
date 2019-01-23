import * as React from 'react'
import { translateWithTracker, Translated } from '../../lib/ReactMeteorData/ReactMeteorData'
import { ICoreSystem, CoreSystem } from '../../../lib/collections/CoreSystem'
import { MeteorReactComponent } from '../../lib/MeteorReactComponent'
import { meteorSubscribe, PubSub } from '../../../lib/api/pubsub'
import { EditAttribute } from '../../lib/EditAttribute';

interface IProps {

}

interface ITrackedProps {
	coreSystem: ICoreSystem | undefined
}

export default translateWithTracker<IProps, {}, ITrackedProps>((props: IProps) => {
	return {
		coreSystem: CoreSystem.findOne()
	}
})(class SystemMessages extends MeteorReactComponent<Translated<IProps & ITrackedProps>> {
	componentDidMount () {
		meteorSubscribe(PubSub.coreSystem, null)
	}
	render () {
		const { t } = this.props

		return this.props.coreSystem ? (
			<div className='studio-edit mod mhl mvs'>
				<div>
					<h3>{t('System Message')}</h3>
					<label className='field'>
						{t('Message')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='systemInfo.message'
								obj={this.props.coreSystem}
								type='text'
								collection={CoreSystem}
								className='mdinput' />
							<span className='mdfx'></span>
						</div>
					</label>
					<div className='field'>
						{t('Enabled')}
						<div className='mdi'>
							<EditAttribute
								attribute='systemInfo.enabled'
								obj={this.props.coreSystem}
								type='checkbox'
								collection={CoreSystem}></EditAttribute>
						</div>
					</div>
					<h3>{t('Support Message')}</h3>
					<label className='field'>
						{t('Message')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='support.message'
								obj={this.props.coreSystem}
								type='multiline'
								collection={CoreSystem}
								className='mdinput' />
							<span className='mdfx'></span>
						</div>
					</label>
				</div>
			</div>
		) : null
	}
})
