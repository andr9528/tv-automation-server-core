import * as React from 'react'

// @todo: use colours from the scss
// @todo: split can use any source (rather than cam + live)
export default class SplitInputIcon extends React.Component<{ abbreviation?: string }> {
	render () {
		return (
			<svg className='segment_line_item_icon' version='1.1' viewBox='0 0 126.5 89' xmlns='http://www.w3.org/2000/svg'>
				<rect width='63.25' height='89' className='camera'/>
				<rect width='63.25' height='89' x='63.25' className='remote'/>
				<text x='5' y='66.514' style={{ fill: '#ffffff', 'fontFamily': 'open-sans', 'fontSize': '40px', 'letterSpacing': '0px', 'lineHeight': '1.25', 'wordSpacing': '0px', 'textShadow': '0 2px 9px rgba(0, 0, 0, 0.5)' }} xmlSpace='preserve'>
					<tspan x='5' y='66.514' style={{fill: '#ffffff', 'fontFamily': 'Roboto', 'fontSize': '62px', 'fontWeight': 100}}>
						{this.props.abbreviation ? this.props.abbreviation : 'Spl'}
					</tspan>
				</text>
			</svg>
		)
	}
}
