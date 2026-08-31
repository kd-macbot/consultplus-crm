import { describe, it, expect } from 'vitest'
import {
  parseFeed, decodeEntities, stripTags, tagText, findFeedLink, looksLikeFeed,
  absolute, parseDate, clip,
} from './rss'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>КиК Инфо — НАП</title>
    <item>
      <title><![CDATA[Нови срокове по чл. 55 ЗДДФЛ]]></title>
      <link>https://kik-info.com/novini/1234</link>
      <description>&lt;p&gt;НАП напомня за срока&lt;/p&gt;</description>
      <pubDate>Mon, 25 Aug 2026 07:30:00 +0300</pubDate>
    </item>
    <item>
      <title>Промени в ДДС &amp; отчетността</title>
      <link>/novini/1200</link>
      <description>Кратко описание</description>
      <pubDate>Fri, 22 Aug 2026 09:00:00 +0300</pubDate>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Държавен вестник</title>
  <entry>
    <title>Брой 68 от 2026 г.</title>
    <link rel="self" href="https://dv.bg/self/68"/>
    <link rel="alternate" href="https://dv.bg/broy/68"/>
    <summary>Обнародвани са промени</summary>
    <published>2026-08-24T06:00:00Z</published>
  </entry>
</feed>`

describe('parseFeed — RSS', () => {
  const items = parseFeed(RSS, 'https://kik-info.com/novini/nap/')

  it('вади заглавие, линк, резюме и дата', () => {
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Нови срокове по чл. 55 ЗДДФЛ')
    expect(items[0].link).toBe('https://kik-info.com/novini/1234')
    expect(items[0].summary).toBe('НАП напомня за срока')
    expect(items[0].published).toBe('2026-08-25T04:30:00.000Z')
  })
  it('превръща относителния линк в пълен', () => {
    expect(items[1].link).toBe('https://kik-info.com/novini/1200')
  })
  it('декодира entity-та в заглавието', () => {
    expect(items[1].title).toBe('Промени в ДДС & отчетността')
  })
  it('подрежда най-новото отгоре', () => {
    expect(items[0].published! > items[1].published!).toBe(true)
  })
})

describe('parseFeed — Atom', () => {
  it('взима линка от rel="alternate", не от rel="self"', () => {
    const items = parseFeed(ATOM, 'https://dv.bg/')
    expect(items).toHaveLength(1)
    expect(items[0].link).toBe('https://dv.bg/broy/68')
    expect(items[0].title).toBe('Брой 68 от 2026 г.')
    expect(items[0].published).toBe('2026-08-24T06:00:00.000Z')
  })
})

describe('parseFeed — негодни редове', () => {
  it('пропуска новина без линк — без него тя е слух', () => {
    const xml = `<rss><channel>
      <item><title>Без линк</title></item>
      <item><title>С линк</title><link>https://x.bg/1</link></item>
    </channel></rss>`
    const items = parseFeed(xml, 'https://x.bg/')
    expect(items.map(i => i.title)).toEqual(['С линк'])
  })
  it('пропуска новина без заглавие', () => {
    const xml = `<rss><channel><item><link>https://x.bg/1</link></item></channel></rss>`
    expect(parseFeed(xml, 'https://x.bg/')).toHaveLength(0)
  })
  it('празен феед не хвърля', () => {
    expect(parseFeed('<rss><channel></channel></rss>', 'https://x.bg/')).toEqual([])
    expect(parseFeed('', 'https://x.bg/')).toEqual([])
  })
  it('липсваща дата не изхвърля новината', () => {
    const xml = `<rss><channel><item><title>Т</title><link>https://x.bg/1</link></item></channel></rss>`
    const items = parseFeed(xml, 'https://x.bg/')
    expect(items[0].published).toBeNull()
  })
})

describe('decodeEntities', () => {
  it('&amp; се разгъва НАКРАЯ, за да оцелее двойното кодиране', () => {
    // Ако &amp; се обработи пръв, „&amp;lt;" би станало „<" — тоест
    // текст, който източникът е искал да покаже като „&lt;", изчезва.
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
    expect(decodeEntities('А &amp; Б')).toBe('А & Б')
  })
  it('чете числови entity-та, включително кирилица', () => {
    expect(decodeEntities('&#1053;&#1040;&#1055;')).toBe('НАП')
    expect(decodeEntities('&#x41;')).toBe('A')
  })
  it('маха CDATA обвивката', () => {
    expect(decodeEntities('<![CDATA[текст]]>')).toBe('текст')
  })
})

describe('stripTags', () => {
  it('маха HTML и слепва интервалите', () => {
    expect(stripTags('<p>Първи</p>\n<p>Втори</p>')).toBe('Първи Втори')
  })
})

describe('tagText', () => {
  it('намира таг с атрибути', () => {
    expect(tagText('<title type="text">Х</title>', 'title')).toBe('Х')
  })
  it('връща празно за липсващ таг', () => {
    expect(tagText('<a>1</a>', 'title')).toBe('')
  })
})

describe('findFeedLink', () => {
  it('намира обявения феед в HTML-а и го прави абсолютен', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/style.css">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
    </head></html>`
    expect(findFeedLink(html, 'https://kik-info.com/novini/nap/'))
      .toBe('https://kik-info.com/feed.xml')
  })
  it('връща null, когато няма обявен феед', () => {
    expect(findFeedLink('<html><head></head></html>', 'https://x.bg/')).toBeNull()
  })
})

describe('looksLikeFeed', () => {
  it('познава по content-type и по съдържание', () => {
    expect(looksLikeFeed('', 'application/rss+xml; charset=utf-8')).toBe(true)
    expect(looksLikeFeed('<?xml version="1.0"?><rss version="2.0">', 'text/plain')).toBe(true)
    expect(looksLikeFeed('<feed xmlns="...">', '')).toBe(true)
    expect(looksLikeFeed('<!doctype html><html>', 'text/html')).toBe(false)
  })
})

describe('absolute / parseDate / clip', () => {
  it('счупен адрес се връща както е, вместо да хвърли', () => {
    expect(absolute('няма://адрес', 'не е база')).toBe('няма://адрес')
  })
  it('нечетима дата → null', () => {
    expect(parseDate('онзи ден')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
  it('реже с многоточие и не оставя увиснал интервал', () => {
    // Отрязването пада точно на интервала → той се маха, за да не стои „едно …".
    expect(clip('едно две три', 6)).toBe('едно…')
    expect(clip('едно две три', 8)).toBe('едно дв…')
    expect(clip('късо', 20)).toBe('късо')
  })
})
