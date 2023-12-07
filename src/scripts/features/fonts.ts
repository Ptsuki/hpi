import { canDisplayInterface } from '../index'
import storage from '../storage'

import { PLATFORM, SYSTEM_OS } from '../defaults'
import { eventDebounce } from '../utils/debounce'
import onSettingsLoad from '../utils/onsettingsload'
import errorMessage from '../utils/errormessage'
import { tradThis } from '../utils/translations'
import superinput from '../utils/superinput'

import { google } from '../types/googleFonts'
import { Font } from '../types/sync'

type FontList = {
	family: string
	weights: string[]
	variable: boolean
}[]

type FontUpdateEvent = {
	autocomplete?: HTMLElement
	size?: string
	family?: string
	weight?: string
}

const familyInput = superinput('i_customfont')

const systemfont = (function () {
	const fonts = {
		fallback: { placeholder: 'Arial', weights: ['500', '600', '800'] },
		windows: { placeholder: 'Segoe UI', weights: ['300', '400', '600', '700', '800'] },
		android: { placeholder: 'Roboto', weights: ['100', '300', '400', '500', '700', '900'] },
		linux: { placeholder: 'Fira Sans', weights: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] },
		apple: { placeholder: 'SF Pro Display', weights: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] },
	}

	if (SYSTEM_OS === 'windows') return fonts.windows
	else if (SYSTEM_OS === 'android') return fonts.android
	else if (SYSTEM_OS === 'mac') return fonts.apple
	else if (SYSTEM_OS === 'ios') return fonts.apple
	else return fonts.linux
})()

// Needs a special method to detect system fonts.
// Because of fingerprinting concerns,
// Firefox and safari made fonts.check() useless
function systemFontChecker(family: string): boolean {
	const p = document.createElement('p')
	p.setAttribute('style', 'position: absolute; opacity: 0; font-family: invalid font;')
	p.textContent = 'mqlskdjfhgpaozieurytwnxbcv?./,;:1234567890' + tradThis('New tab')
	document.getElementById('interface')?.prepend(p)

	const first_w = p.getBoundingClientRect().width
	p.style.fontFamily = `'${family}'`

	const second_w = p.getBoundingClientRect().width
	const hasLoadedFont = first_w !== second_w

	p.remove()

	return hasLoadedFont
}

async function waitForFontLoad(family: string): Promise<Boolean> {
	return new Promise((resolve) => {
		let limitcounter = 0
		let hasLoadedFont = systemFontChecker(family)
		let interval = setInterval(() => {
			if (hasLoadedFont || limitcounter === 100) {
				clearInterval(interval)
				return resolve(true)
			} else {
				hasLoadedFont = systemFontChecker(family)
				limitcounter++
			}
		}, 100)
	})
}

async function fetchFontList() {
	const fonts = (await storage.local.get('fonts')).fonts ?? []

	if (fonts.length > 0) {
		return fonts as FontList
	}

	if (!navigator.onLine) {
		return
	}

	// Get list from API
	const a = 'QUl6YVN5QWt5M0pZYzJyQ09MMWpJc3NHQmdMcjFQVDR5VzE1ak9r'
	const url = 'https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&capability=VF&key=' + window.atob(a)
	const resp = await fetch(url)

	// return nothing if smth wrong, will try to fetch next time
	if (!resp.ok) {
		console.warn("Couldn't fetch google fonts")
		return
	}

	const json = (await resp.json()) as google.fonts.WebfontList

	// json has at least one available family
	if (json.items?.length > 0 && 'family' in json.items[0]) {
		const noRegulars = (arr: string[]) => arr.map((weight) => weight.replace('regular', '400'))
		const noItalics = (arr: string[]) => arr.filter((str) => !str.includes('italic'))

		let weights: string[] = []
		let list: FontList = []

		for (const item of json.items) {
			//
			// If variable, infer weights from axes
			if (!!item?.axes) {
				// Some variable fonts doesn't have wght
				if (item.axes.some((axe) => axe.tag === 'wght')) {
					const { start, end } = item.axes.filter((axe) => axe.tag === 'wght')[0]
					for (let ii = start; ii <= end; ii += 100) {
						weights.push(ii.toString())
					}
				} else {
					weights = ['400']
				}

				//
			} else {
				weights = noRegulars(noItalics(item.variants))
			}

			list.push({
				family: item.family,
				variable: !!item?.axes,
				weights,
			})

			weights = []
		}

		storage.local.set({ fonts: list })

		return list as FontList
	}
}

async function fetchFontface(url: string): Promise<string | null> {
	if (!url) {
		return null
	}

	try {
		const resp = await fetch(url)
		const text = await resp.text()
		const fontface = text.replace(/(\r\n|\n|\r|  )/gm, '')

		setFontFace(fontface)

		return fontface
	} catch (error) {
		return null
	}
}

async function getNewFont(currentFamily: string): Promise<Partial<Font> | null> {
	const list = (await fetchFontList()) ?? []
	const foundFonts = list.filter(({ family }) => family.toUpperCase() === currentFamily.toUpperCase())

	if (foundFonts.length > 0) {
		let { family, weights, variable } = foundFonts[0]
		let url = 'https://fonts.googleapis.com/'

		// no variable fonts on firefox because of aggregious load times (~70ms)
		if (variable && PLATFORM !== 'firefox') {
			const wght = weights.length > 1 ? `:wght@${weights[0]}..${weights.at(-1)}` : ''
			url += encodeURI(`css2?family=${family.replace(/ /g, '+')}${wght}`)
		} else {
			const wght = weights.length > 1 ? `:${weights.join(',')}` : ''
			url += encodeURI(`css?family=${family.replace(/ /g, '+')}${wght}`)
		}

		return {
			url,
			family,
			weight: '400',
			availWeights: weights,
		}
	}

	return null
}

function setFontFace(fontface: string | null) {
	if (typeof fontface === 'string') {
		const domfontface = document.createElement('style') as HTMLStyleElement
		domfontface.className = 'fontface'
		domfontface.textContent = fontface
		document.querySelector('head')?.appendChild(domfontface)
	}
}

function setSize(val: string) {
	document.documentElement.style.setProperty('--font-size', parseInt(val) / 16 + 'em') // 16 is body px size
}

function setWeight(family: string, weight: string) {
	const clockWeight = parseInt(weight) > 100 ? systemfont.weights[systemfont.weights.indexOf(weight) - 1] : weight

	document.documentElement.style.setProperty('--font-weight', weight)
	document.documentElement.style.setProperty('--font-weight-clock', family ? weight : clockWeight) // Default bonjourr lowers font weight on clock (because we like it)
}

function setFamily(family: string) {
	document.documentElement.style.setProperty('--font-family', family ? `"${family}"` : null)
}

async function setAutocompleteSettings(settingsDom: HTMLElement) {
	const dl_fontfamily = settingsDom.querySelector('#dl_fontfamily') as HTMLSelectElement

	if (dl_fontfamily.childElementCount > 0) {
		return
	}

	const fontlist = await fetchFontList()
	const fragment = new DocumentFragment()

	for (const item of fontlist ?? []) {
		const option = document.createElement('option')
		option.textContent = item.family
		option.value = item.family
		fragment.appendChild(option)
	}

	dl_fontfamily?.appendChild(fragment)
}

async function setWeightSettings(weights: string[], settingsDom?: HTMLElement) {
	const settings = settingsDom ? settingsDom : document.getElementById('settings')
	const options = settings?.querySelectorAll<HTMLOptionElement>('#i_weight option')

	options?.forEach((option) => {
		const weightExists = weights.includes(option.value)
		option.classList.toggle('hidden', !weightExists)
	})
}

async function initFontSettings(font: Font | null) {
	const settings = document.getElementById('settings') as HTMLElement
	const hasCustomWeights = font && font.availWeights.length > 0
	const weights = hasCustomWeights ? font.availWeights : systemfont.weights
	const family = font?.family || systemfont.placeholder

	settings.querySelector('#i_customfont')?.setAttribute('placeholder', family)
	setWeightSettings(weights, settings)

	if (font?.url) {
		setAutocompleteSettings(settings)
	}
}

async function updateFont({ family, weight, size }: FontUpdateEvent) {
	const i_customfont = document.getElementById('i_customfont') as HTMLInputElement
	const isRemovingFamily = typeof family === 'string' && family.length === 0
	const isChangingFamily = typeof family === 'string' && family.length > 1

	const { font } = await storage.sync.get('font')

	if (isRemovingFamily) {
		const i_weight = document.getElementById('i_weight') as HTMLInputElement
		const baseWeight = SYSTEM_OS === 'windows' ? '400' : '300'

		document.documentElement.style.setProperty('--font-family', '')
		document.documentElement.style.setProperty('--font-weight-clock', '200')
		document.documentElement.style.setProperty('--font-weight', baseWeight)

		for (const el of document.querySelectorAll('.fontface')) {
			el.remove()
		}

		storage.local.remove('fontface')

		setWeight('', '400')
		setWeightSettings(systemfont.weights)

		i_customfont.value = ''
		i_customfont.placeholder = systemfont.placeholder
		i_weight.value = baseWeight

		eventDebounce({ font: { size: font.size, url: '', family: '', availWeights: [], weight: baseWeight } })
	}

	if (isChangingFamily) {
		const i_weight = document.getElementById('i_weight') as HTMLSelectElement

		let fontface: string | null = null
		let newfont = {
			url: '',
			family: '',
			weight: '400',
			availWeights: ['200', '300', '400', '500', '600', '700', '800', '900'],
		}

		if (systemFontChecker(family)) {
			newfont.family = family
		} else {
			familyInput.load()

			const googlefont = await getNewFont(family)

			if (googlefont && navigator.onLine) {
				newfont = { ...newfont, ...googlefont }
				fontface = await fetchFontface(newfont.url)

				await waitForFontLoad(family)
				familyInput.toggle(false, family)

				storage.local.set({ fontface })
			}
		}

		if (newfont.family === '') {
			familyInput.warn(`Cannot load "${family}"`)
			return
		}

		setFamily(family)
		setWeight(family, '400')
		i_weight.value = '400'

		setWeightSettings(newfont.availWeights)
		eventDebounce({ font: { size: font.size, ...newfont } })
	}

	if (weight) {
		font.weight = weight || '400'
		setWeight(font.family, font.weight)
		eventDebounce({ font: font })
	}

	if (size) {
		font.size = size
		setSize(size)
		eventDebounce({ font: font })
	}
}

export default async function customFont(init: { font: Font; fontface?: string } | null, event?: FontUpdateEvent) {
	if (event?.autocomplete) {
		return setAutocompleteSettings(event?.autocomplete)
	}

	if (event) {
		return updateFont(event)
	}

	if (init) {
		try {
			const { size, family, weight, url } = init.font

			setSize(size)
			setWeight(family, weight)
			setFamily(family)

			if (url) {
				let fontface: string | null = init.fontface ?? ''

				if (!fontface.includes('@font-face') || !fontface.includes(family)) {
					fontface = await fetchFontface(url)
					if (fontface) storage.local.set({ fontface })
				}

				setFontFace(fontface)
			}

			onSettingsLoad(() => {
				initFontSettings(init?.font)
			})

			canDisplayInterface('fonts')
		} catch (e) {
			errorMessage(e)
		}
	}
}
