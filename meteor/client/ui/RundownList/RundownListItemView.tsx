import Tooltip from 'rc-tooltip'
import React, { ReactElement } from 'react'
import { withTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { INoteBase, NoteType } from '../../../lib/api/notes'
import { Rundown } from '../../../lib/collections/Rundowns'
import { Translated } from '../../lib/ReactMeteorData/ReactMeteorData'
import { RundownUtils } from '../../lib/rundown'
import { iconDragHandle, iconRemove, iconResync } from './icons'
import JonasFormattedTime from './JonasFormattedTime'
import RundownListItemProblems from './RundownListItemProblems'

interface IRundownListItemViewProps {
	isActive: boolean
	classNames: string[]
	htmlElementId: string
	connectDragSource: (content: ReactElement) => ReactElement | null
	rundownViewUrl?: string
	rundown: Rundown
	showStyleBaseURL?: string
	showStyleName: string | undefined
	confirmReSyncRundownHandler?: () => void
	confirmDeleteRundownHandler?: () => void
	isDragLayer: boolean
	connectDropTarget: (content: ReactElement) => ReactElement | null
	renderTooltips: boolean
}

export default withTranslation()(function RundownListItemView(props: Translated<IRundownListItemViewProps>) {
	const {
		isActive,
		t,
		connectDragSource,
		connectDropTarget,
		htmlElementId,
		rundownViewUrl,
		showStyleBaseURL,
		showStyleName,
		rundown,
		confirmReSyncRundownHandler,
		confirmDeleteRundownHandler,
	} = props

	const classNames = props.classNames.slice()
	classNames.push('rundown-list-item')
	if (props.isDragLayer) {
		classNames.push('dragging')
	}

	const rundownNameContent = rundownViewUrl ? <Link to={rundownViewUrl}>{props.rundown.name}</Link> : props.rundown.name

	// const [warnings, errors] = getAllNotes(rundown)

	return connectDropTarget(
		<li id={htmlElementId} className={classNames.join(' ')}>
			<span className="rundown-list-item__name">
				{connectDragSource(
					<span className="draghandle">
						<Tooltip
							overlay={t('Drag to reorder or move out of playlist')}
							placement="top"
							overlayStyle={{ display: props.renderTooltips ? undefined : 'none' }}>
							<button className="rundown-list-item__action">{iconDragHandle()}</button>
						</Tooltip>
					</span>
				)}
				<b className="rundown-name">{rundownNameContent}</b>
				{isActive === true ? (
					<Tooltip overlay={t('This rundown is currently active')} placement="bottom">
						<div className="origo-pulse small right mrs">
							<div className="pulse-marker">
								<div className="pulse-rays"></div>
								<div className="pulse-rays delay"></div>
							</div>
						</div>
					</Tooltip>
				) : null}
			</span>
			{/* <RundownListItemProblems warnings={warnings} errors={errors} /> */}
			<span className="rundown-list-item__text">
				{showStyleBaseURL ? <Link to={showStyleBaseURL}>{showStyleName}</Link> : showStyleName || ''}
			</span>
			<span className="rundown-list-item__text">
				{rundown.expectedStart ? (
					<JonasFormattedTime timestamp={rundown.expectedStart} t={t} />
				) : (
					<span className="dimmed">{t('Not set')}</span>
				)}
			</span>
			<span className="rundown-list-item__text">
				{rundown.expectedDuration ? (
					RundownUtils.formatDiffToTimecode(rundown.expectedDuration, false, true, true, false, true)
				) : (
					<span className="dimmed">{t('Not set')}</span>
				)}
			</span>
			<span className="rundown-list-item__text">
				<JonasFormattedTime timestamp={rundown.modified} t={t} />
			</span>
			<span className="rundown-list-item__actions">
				{confirmReSyncRundownHandler ? (
					<Tooltip
						overlay={t('Re-sync rundown data with {{nrcsName}}', { nrcsName: rundown.externalNRCSName || 'NRCS' })}
						placement="top">
						<button className="rundown-list-item__action" onClick={() => confirmReSyncRundownHandler()}>
							{iconResync()}
						</button>
					</Tooltip>
				) : (
					<span className="rundown-list-item__action"></span>
				)}
				{confirmDeleteRundownHandler ? (
					<Tooltip overlay={t('Delete')} placement="top">
						<button className="rundown-list-item__action" onClick={() => confirmDeleteRundownHandler()}>
							{iconRemove()}
						</button>
					</Tooltip>
				) : null}
			</span>
		</li>
	)
})

/**
 * Gets all notes associated with a rundown and returns two separate arrays of
 * notes for warnings and errors.
 * NOTE: fetching notes for parts and segments this way does not work, which is
 * the reason problems aren't currently displayed in the lobby. This function is
 * left for later reference, and can not be considered reliable.
 *
 * @param rundown the rundown to get notes for
 * @returns [warnings, errors]
 */
function getAllNotes(rundown: Rundown): [INoteBase[], INoteBase[]] {
	const allNotes: INoteBase[] = []

	if (rundown.notes) {
		allNotes.push(...rundown.notes)
	}

	for (const segment of rundown.getSegments()) {
		if (segment.notes) {
			allNotes.push(...segment.notes)
		}

		for (const part of segment.getParts()) {
			if (part.notes) {
				allNotes.push(...part.notes)
			}
		}
	}

	const warnings: INoteBase[] = []
	const errors: INoteBase[] = []

	for (const note of allNotes) {
		if (!note) continue

		switch (note.type) {
			case NoteType.ERROR:
				errors.push(note)
				break
			case NoteType.WARNING:
				warnings.push(note)
				break
		}
	}

	return [warnings, errors]
}
