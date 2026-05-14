import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { getClients, getColumns, getDropdownOptions, addDropdownOption } from '../lib/storage'
import type { Column } from '../lib/types'

function norm(s = '') {
  return s.replace(/\s+/g, ' ').trim()
}

function normForEik(s = '') {
  return s
    .replace(/["""]/g, ' ')
    .replace(/[–—]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function stripEntityIterative(s: string): string {
  const entityRe = /\s+(ЕООД|ООД|ЕАД|АД|ЕДПК|ЕТ|ЗП)$/
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(entityRe, '').trim()
  }
  return s
}

type CellRecord = {
  client_id: string
  column_id: string
  value_text: string | null
  value_number: number | null
  value_date: string | null
  value_bool: boolean | null
  value_dropdown: string | null
}

const CSV_RAW = `2Б ООД;НУЛЕВО;;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
АВОМИС ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
АГРИ СТРОЙ ЕООД;НУЛЕВО;;ВИОЛИНА  МИТАКСОВА;;
АГРОГРУП 2017 ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;;
АГРОДЕН ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;СОЛ+
АДВАНС ХОУМС ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;А1
АДВОКАТСКО СЪДРУЖИЕ ЗЛАТКОВА И БРЕЗОВСКА;АКТИВНА;ПЕТЯ  ПАВЛОВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
АДРИАТИКА БЛУ ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;ВИОЛИНА  МИТАКСОВА;СИЛВИЯ  ИВАНОВА;ДУК+
АКВА КРАФТ ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
АЛЕКС К 2002 ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
АЛЕКС С 2002 ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;ДУК+
АЛИСА 34 ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
АНВЕРС КОМЕРС ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;РАДКА НИКОЛОВА;;
АНВЕРС КОМЕРСИАЛ ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;РАДКА НИКОЛОВА;;
АНВЕРС КОНСТРУКТ ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;РАДКА НИКОЛОВА;СИЛВИЯ  ИВАНОВА;ДУК+
АНВЕРС КОНСУЛТ ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
АРИМА КОНСУЛТ ООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
АРТИСЕТ ООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
АСЕТ ИНВЕСТМЪНТ ЕООД;НУЛЕВО;АНУШКА РАДЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
АСЕТ ФАРМА ЕООД;НУЛЕВО;АНУШКА РАДЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
АСИ 75;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
БОНАФАЙД ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
БОРЕ ГРУП ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
БРАТЯ ДИМОВИ 2009 ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ВАИС ГРУП 77 ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ВАЛСПОРТ 84 ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ВАТЕРПОЛО КОМЕРС ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;;
ВЕК ТРЕЙДИНГ ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ВИКИ 2 ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ВИКИВАТ ООД;АКТИВНА;РАДКА НИКОЛОВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;СОЛ+
ВИЛХЕЛМ БЪЛГАРИЯ ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ДЖИВИЕМСИ МЕНПАУЪР МЕНИДЖМЪНТ ООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
ВОМИС КОНСУЛТ ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ГЕЗЕДЖИ ООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
ГЕРИ МУР 2016 ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ГЛИТ ЦРО ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
ГРАФИС ООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
ГРИЙН ХОУМС ЕООД;НУЛЕВО;АНУШКА РАДЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ДАРЛИН БЮТИ ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
ДЕЙВИД ПИЕР БЮНЕТ;АКТИВНА;ДИМИТРИНА  КОЛЕВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ГИМЕС ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ДЕЙВИД ПОСТАЛ МАРКЕТ ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ДЕЙВИД ПРОФЕШЪНЪЛ ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ДЖИ ТИ ДРАЙВ ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;;
ДИВЕРСО ГРУП 13 ООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ДИГИ ООД;БЕЗ ДДС;;;;
ДИГИ 84 ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ДИЕНДИ - ФАРМ ЕООД;НУЛЕВО;АНУШКА РАДЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ДИОНИС 13  ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
Д-Р ПЕНКА АТАНАСОВА;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ДРАЙВ ХЪБ ЕООД;АКТИВНА;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
Дуайен Юръп-Производство на строителни химикали ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
ЕВРОТЕХ БЪЛГАРИЯ 2022 ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ЕКОТЕРМ БЪЛГАРИЯ ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ЕЛ БЪЛГАРИЯ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;СИЛВИЯ  ИВАНОВА;ДУК+
ЕЛ БЪЛГАРИЯ ЕООД - ОСС;АКТИВНА;ВИОЛИНА  МИТАКСОВА;ВИОЛИНА  МИТАКСОВА;;
ЕЛИНМАР ООД;БЕЗ ДДС;;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ЕСиЕМ ИНТЕРИО;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
ЕН ТИ ДЖИ ГРУП 19 ЕДПК;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
ЕРДЖИ 2000 ЕООД;БЕЗ ДДС;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ЕС ФОР БИ ООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;;
ЕТ ВИКИВАТ;БЕЗ ДДС;РАДКА НИКОЛОВА;КРАСИМИРА  ГЕОРГИЕВА;;
ЖИЗАТЕКС ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;;
ЗВЕЗДА 21 ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;ВИОЛИНА  МИТАКСОВА;;
ЗДРАВЧЕВИ ТРАНС ООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ЗЕМЕДЕЛСКО СТОПАНСТВО ПЕРУЩИЦА ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ЗП ВЕЛИ КАРАХОДЖЕВ;БЕЗ ДДС;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;;
ИВС ИНВЕСТ ООД;БЕЗ ДДС;РАДКА НИКОЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ИМЕРИС МИНЕРАЛС БЪЛГАРИЯ АД;АКТИВНА;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
ИНВЕНИО БЪЛГАРИЯ ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;Служители
ИНВЕНИО РК ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;Служители
ИНВЕСТ ЛУКС ПРОПЪРТИ ЕООД;НУЛЕВО;АНУШКА РАДЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ИСИ ПЛОВДИВ ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ИСИ ПЛОВДИВ ЕООД - одиторски файл;АКТИВНА;ВИОЛИНА  МИТАКСОВА;ВИОЛИНА  МИТАКСОВА;;
КАЛМАНОЛА ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ЙОШИ ЕООД;БЕЗ ДДС;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
КАР ДЕ ЛУКС 88 ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
КАРБУ ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
КИАРА НОВЕ ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
КИАРА ПРИВЕ ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
КИАРА - ФАРМ ЕООД;НУЛЕВО;АНУШКА РАДЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
КЛЪСТЪРМАРКЕТ БЪЛГАРИЯ ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
КМД ИМОТИ ЕООД;АКТИВНА;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
КМК 05 ООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
КОНСТРУКТ СТРОЙ ООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
КОНСУЛТ ПЛЮС ЕООД;АКТИВНА;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;
КОРЕКТ ИВ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
КРЮ РЕПУБЛИК ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
КТК-КЪМПЛИТ ТРЕЙДИНГ КЪМПАНИ ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
КЮ ЕС ДЖИ ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
ЛБГ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;;
ЛТИ ИНЖЕНЕРИНГ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ЛУЛЧЕВ - 55 ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ЛЮБА ФЕШЪН ЕООД;БЕЗ ДДС;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
МА КАПКА ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
МАРИАНА КОЛЕВА 1 ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
МАРИАНА КОЛЕВА 11 ЕООД;БЕЗ ДДС;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
МАРИАНА КОЛЕВА 7 ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
МАРИАНА КОЛЕВА 7А ЕООД;БЕЗ ДДС;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
МАРИЯНА КОЛЕВА 1 ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
МАРИЯНА КОЛЕВА 11 ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
МАРИЯНА КОЛЕВА 7 ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
МАРИЯНА КОЛЕВА 7А ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
МАРКЕТИНГ БГ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;;
МАРТКОНСУЛТ 21 ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
МАРЧЕЛКАА ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
МАСТЪР АСЕТ ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
МАГАЗИН ВИКИВАТ;АКТИВНА;РАДКА НИКОЛОВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;ДУК
МЕГА МАРКЕТ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;;
МЕГА МАРКЕТ ИМОТИ ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
МЕГА МАРКЕТ ИМПОРТ ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
МЕГА МАРКЕТ ИНВЕСТ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;;
МЕГА МАРКЕТ РИТЕЙЛ ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
МЕДИА КРИС ЕООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
МЕЛИТЕК ООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;РАДКА НИКОЛОВА;;
МИКС 24 ООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
МИЛЕНИУМ С ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
МИРОКС ДЕКОР ООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
МК ИМОТИ ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;;
МУСОНИ ОАЗИС ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;ВИОЛИНА  МИТАКСОВА;;
МУСОНИ БЪЛГАРИЯ ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;ВИОЛИНА  МИТАКСОВА;;
НАДИ 86 ООД;АКТИВНА;РАДКА НИКОЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
НЕФИ 1 ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;;
НОТА МЕДЖИК ЕДПК;АКТИВНА;ДИМИТРИНА  КОЛЕВА;РАДКА НИКОЛОВА;;
НЮ ЕСТЕЙТ 2024 ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ОЙНУР ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ОЛИВИЕ АНРИ АНТОНИО УСАН;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ПАДЕЛ КЛУБ ПЛОВДИВ ЕООД;АКТИВНА;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
ПЕРЛАИНВЕСТ ООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ПЕРМАНЕНЦА ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ПЛАМА СОФТ ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ПЛОЧКИТЕ ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ПРЕКОС ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ПРОМИШЛЕНИ ДЕЙНОСТИ - 1 ООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ПРОПЪРТИ ХЪБ;АКТИВНА;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ПРОТЕА - 2000 ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
РАДЕВИ 2019 ЕООД;АКТИВНА;ПЕТЯ  ПАВЛОВА;РАДКА НИКОЛОВА;;
РВР ГРУП ЕООД;АКТИВНА;;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
РЕНТАРО ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
РЕТУР 07 ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
РИЛУСЕНТ ЕООД;АКТИВНА;;КРАСИМИРА  ГЕОРГИЕВА;;
РОЯЛ ВИЖЪН ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
САМПО;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;
СГ - ИМОТИ ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;;
СИГНЪС ТРЕЙД ООД;НУЛЕВО;;РАДКА НИКОЛОВА;;
СИДИ ТРЕЙД ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
СИЛВЕРЕРО ООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
СИП 2026 ЕООД;;ГАЛИНА ГЕОРГИЕВА;;;
СИРИУС ДЪКС ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
СКЕЙЛЪП ООД;НУЛЕВО;АНУШКА РАДЕВА;РАДКА НИКОЛОВА;;
СЛАВЕКС НОВА ТРЕЙД ЕООД;БЕЗ ДДС;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
СО СПЕКТЪР ЕАД;АКТИВНА;ПЕТЯ  ПАВЛОВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
СТ ПРОПЪРТИС ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;
СТИЛ ЕНД ВЕС 2 ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;ДУК+
СТИЛ ЕНД ВЕС ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;КРАСИМИРА  ГЕОРГИЕВА;СИЛВИЯ  ИВАНОВА;ДУК+
СЪНИ ТРИЙТС ЕООД;БЕЗ ДЕЙНОСТ;РАДКА НИКОЛОВА;РАДКА НИКОЛОВА;;
ТЕРА 2000 ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ТИТАН - ХХ ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ТМТ ГЛОБЪЛФАРМ ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ТМТ ГРУП ФАРМА ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ТМТ ФАРМА ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ТМТ ФАРМА ГРУП ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ТОЙ ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ТОП ТЕН ИНВЕСТ;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
УАЙН ХЪНТ ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
УЕСТ ПРОПЪРТИ ИНВЕСТМЪНТ ЕООД;НУЛЕВО;АНУШКА РАДЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ФАБИО СИЛВАН ДЕ РОЗ;БЕЗ ДДС;ДИМИТРИНА  КОЛЕВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ФАРМАМЕД ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ФАРМГЛОУ ЕООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;;
ФИЛОСОФИЯ НА ВКУСА ООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ФИНЕСТА ЕООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ФЛЕАР ЕВРОПА ООД;АКТИВНА;КРАСИМИРА  ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ФМ ПЛЮС ГРУП ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ФРАНЧЕСКО СОЛЮШЪНС ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;РАДКА НИКОЛОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ФРЕА 28 ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;СИЛВИЯ  ИВАНОВА;ДУК+
ФРЕА ЕООД;БЕЗ ДДС;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ФРУКТ КОМЕРС ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ХЕЛТИ ТРИЙТС ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;Служители
ФУТУРО ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ХЕЛТИ ЛАЙФ 2022;АКТИВНА;ДИМИТРИНА  КОЛЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК
ХЕМИНГУЕЙ БЪЛГАРИЯ ЕООД;АКТИВНА;ГАЛИНА ГЕОРГИЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ+
ХЕМИНГУЕЙ БЪЛГАРИЯ ЕООД - одиторски файл;АКТИВНА;ВИОЛИНА  МИТАКСОВА;ВИОЛИНА  МИТАКСОВА;;
ХЕРКО ООД;АКТИВНА;СИЛВИЯ СТОЯНЧЕВА;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ХИСАР-МИЛЕНИУМ ООД;АКТИВНА;АНГЕЛ ТОДОРОВ;ВИОЛИНА  МИТАКСОВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ХРИСТИ 7777 ЕООД;БЕЗ ДДС;ГАЛИНА ГЕОРГИЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;СОЛ
ХЪМИНГБЪРД ТРАВЕЛ БЪЛГАРИЯ ЕООД;АКТИВНА;ДИМИТРИНА  КОЛЕВА;КРАСИМИРА  ГЕОРГИЕВА;АТАНАСКА  ГОСПОДИНОВА;ДУК+
ШОП 650 ЕООД;АКТИВНА;АНГЕЛ ТОДОРОВ;КРАСИМИРА  ГЕОРГИЕВА;;`

const CSV_ROWS = CSV_RAW.split('\n').filter(Boolean).map(line => {
  const [n = '', s = '', a = '', sub = '', tr = '', ts = ''] = line.split(';')
  return {
    name: norm(n),
    status: norm(s),
    accountant: norm(a),
    substitute: norm(sub),
    tpzResp: norm(tr),
    tpzStatus: norm(ts),
  }
}).filter(r => r.name)

// Hardcoded aliases for names in the EIK file that differ from CRM names
const EIK_ALIASES: Record<string, string> = {
  'ДЕЙВИД БЮНЕТ ПИЕР': 'ДЕЙВИД ПИЕР БЮНЕТ',
  'ОЛИВИЕР': 'ОЛИВИЕ АНРИ АНТОНИО УСАН',
}

const EIK_DATA: { name: string; eik: string }[] = [
  { name: '"ФИЛОСОФИЯ НА ВКУСА" ООД', eik: '206881704' },
  { name: 'АДВАНС ХОУМС ООД ООД', eik: '208584178' },
  { name: 'АГРОГРУП 2017 ООД', eik: '204465251' },
  { name: 'АГРОДЕН ООД', eik: '115760921' },
  { name: 'АДРИАТИКА БЛУ ЕООД', eik: '115870645' },
  { name: 'АДВОКАТСКО СЪДРУЖИЕ"ЗЛАТКОВА И БРЕЗОВСКА', eik: '181084391' },
  { name: 'АЛЕКС - К 2002 ЕООД', eik: '200776753' },
  { name: 'АЛЕКС - С - 2002 ЕООД', eik: '115750028' },
  { name: 'БОРЕ ГРУП ЕООД', eik: '205143100' },
  { name: 'БРАТЯ ДИМОВИ 2009 ООД', eik: '200830158' },
  { name: 'ВАЛСПОРТ 84 ЕООД', eik: '205246189' },
  { name: 'ВАТЕРПОЛО КОМЕРС', eik: '40145577' },
  { name: 'ВЕК ТРЕЙДИНГ ООД', eik: '115662135' },
  { name: 'ВИКИ 2 ООД', eik: '160133764' },
  { name: 'ВИКИВАТ ООД', eik: '160138003' },
  { name: 'ВИЛХЕЛМ БЪЛГАРИЯ ЕООД', eik: '206060045' },
  { name: 'ГЕРИ МУР 2016 ЕООД', eik: '204079869' },
  { name: 'ГЛИТ ЦРО ЕООД', eik: '206121726' },
  { name: 'ГРАФИС ООД', eik: '825282444' },
  { name: 'ДЕЙВИД ПОСТАЛ МАРКЕТ ООД', eik: '825383518' },
  { name: 'ДЕЙВИД ПРОФЕШЪНЪЛ ООД', eik: '206593965' },
  { name: 'ДЖИВИЕМСИ МЕНПАУЪР МЕНИДЖМЪНТ ООД', eik: '207373438' },
  { name: 'ДЖИ ТИ ДРАЙВ ЕООД', eik: '208646936' },
  { name: 'ДИВЕРСО ГРУП 13 ООД', eik: '202685892' },
  { name: 'ДЕЙВИД БЮНЕТ ПИЕР', eik: '181399113' },
  { name: 'ДИГИ 84 ООД', eik: '115881104' },
  { name: 'ЕВРОТЕХ БЪЛГАРИЯ 2022 ЕООД', eik: '206828438' },
  { name: 'ЕКОТЕРМ БЪЛГАРИЯ ЕООД', eik: '201915775' },
  { name: 'ЕЛ БЪЛГАРИЯ ЕООД', eik: '115827416' },
  { name: 'ЗВЕЗДА 21 ЕООД', eik: '206368751' },
  { name: 'ИМЕРИС МИНЕРАЛС БЪЛГАРИЯ АД', eik: '108010951' },
  { name: 'ИНВЕНИО БЪЛГАРИЯ ЕООД', eik: '206088977' },
  { name: 'ИНВЕНИО РК ЕООД', eik: '203734738' },
  { name: 'ИСИ ПЛОВДИВ ЕООД', eik: '205851380' },
  { name: 'КАЛМАНОЛА ЕООД', eik: '207276526' },
  { name: 'КИАРА НОВЕ ЕООД', eik: '208338810' },
  { name: 'КОРЕКТ ИВ ЕООД', eik: '115874800' },
  { name: 'КАР ДЕ ЛУКС 88 ЕООД', eik: '205976996' },
  { name: 'КЛЪСТЪРМАРКЕТ - БЪЛГАРИЯ ЕООД', eik: '206569708' },
  { name: 'КМК - 05 ООД', eik: '115865502' },
  { name: 'КТК – КЪМПЛИТ ТРЕЙДИНГ КЪМПАНИ ЕООД', eik: '205176812' },
  { name: 'ЛБГ ЕООД', eik: '204127303' },
  { name: 'ЛТИ - ИНЖЕНЕРИНГ ЕООД', eik: '201295299' },
  { name: 'МАРИАНА КОЛЕВА 7 ЕООД', eik: '203888526' },
  { name: 'МАРКЕТИНГ БГ ЕООД', eik: '206610020' },
  { name: 'МАРТКОНСУЛТ 21 ЕООД', eik: '206475641' },
  { name: 'МЕГА МАРКЕТ РИТЕЙЛ ЕООД', eik: '201759276' },
  { name: 'МЕЛИТЕК ООД', eik: '207956177' },
  { name: 'МИРОКС ДЕКОР ООД', eik: '200149206' },
  { name: 'НОТА МЕДЖИК ЕДПК', eik: '208531478' },
  { name: 'НЮ ЕСТЕЙТ 2024 ЕООД', eik: '207774609' },
  { name: 'ОЛИВИЕР', eik: '181325668' },
  { name: 'ПЕРМАНЕНЦА ЕООД', eik: '208208182' },
  { name: 'ПЕРЛАИНВЕСТ ООД', eik: '831274943' },
  { name: 'ПЛАМА СОФТ ООД', eik: '207862703' },
  { name: 'ПЛОЧКИТЕ ЕООД', eik: '202157175' },
  { name: 'ПРЕКОС ООД', eik: '115915510' },
  { name: 'РЕНТАРО ЕООД', eik: '207260114' },
  { name: 'САМПО ООД', eik: '115150310' },
  { name: 'СИРИУС ДЪКС ООД', eik: '208184885' },
  { name: 'СИДИ ТРЕЙД ЕООД', eik: '115853628' },
  { name: 'СО - СПЕКТЪР ЕАД', eik: '115018585' },
  { name: 'СТ ПРОПЪРТИС ООД', eik: '206748038' },
  { name: 'СТИЛ ЕНД  ВЕС ООД', eik: '203323459' },
  { name: 'СТИЛ ЕНД ВЕС 2 ООД', eik: '205283325' },
  { name: 'ТИТАН - ХХ ООД', eik: '115850614' },
  { name: 'ТОЙ ЕООД', eik: '207222735' },
  { name: 'УАЙН ХЪНТ ЕООД', eik: '208077762' },
  { name: 'ТОП ТЕН ИНВЕСТ ЕООД', eik: '205303658' },
  { name: 'ФАБИО СИЛВАН ДЕ РОЗ', eik: '181313783' },
  { name: 'ФАРМГЛОУ ЕООД', eik: '208338874' },
  { name: 'ФИНЕСТА ЕООД', eik: '160037776' },
  { name: 'ФМ ПЛЮС ГРУП ЕООД', eik: '115516251' },
  { name: 'ФРАНЧЕСКО СОЛЮШЪНС ЕООД', eik: '208129771' },
  { name: 'ФРЕА 28 ООД ЕООД', eik: '160097617' },
  { name: 'ФРУКТ КОМЕРС ООД', eik: '115765384' },
  { name: 'ФЛЕАР ЕВРОПА ООД', eik: '207975843' },
  { name: 'ФУТУРО ЕООД', eik: '115888110' },
  { name: 'ХЕЛТИ ТРИЙТС ЕООД', eik: '204207742' },
  { name: 'ХЕЛТИ ЛАЙФ 2022 ЕООД', eik: '207130799' },
  { name: 'ХЕМИНГУЕЙ БЪЛГАРИЯ ЕООД', eik: '115863978' },
  { name: 'ХИСАР - МИЛЕНИУМ ООД', eik: '115566813' },
  { name: 'ХЪМИНГБЪРД ТРАВЕЛ БЪЛГАРИЯ ЕООД', eik: '208079731' },
]

export function ImportPage() {
  const { user } = useAuth()
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [eikPhase, setEikPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [eikLogs, setEikLogs] = useState<string[]>([])

  async function runImport() {
    setPhase('running')
    setLogs([])
    const log = (msg: string) => setLogs(prev => [...prev, msg])

    try {
      // 1. Load and identify columns
      log('📋 Зареждам колони...')
      const columns = await getColumns()
      const uc = (s: string) => s.toUpperCase()

      const nameCol = [...columns].filter(c => c.type === 'text').sort((a, b) => a.position - b.position)[0]
      const statusCol = columns.find(c => uc(c.name).includes('СТАТУС') && !uc(c.name).includes('ТРЗ'))
      const accountantCol = columns.find(c => uc(c.name).includes('СЧЕТОВОДИТЕЛ'))
      const substituteCol = columns.find(c => uc(c.name).includes('ЗАМЕСТ'))
      const tpzRespCol = columns.find(c => uc(c.name).includes('ТРЗ') && !uc(c.name).includes('СТАТУС'))
      const tpzStatusCol = columns.find(c => uc(c.name).includes('ТРЗ') && uc(c.name).includes('СТАТУС'))

      log(`  Фирма: "${nameCol?.name ?? '—'}"  Статус: "${statusCol?.name ?? '—'}"  Счетоводител: "${accountantCol?.name ?? '—'}"`)
      log(`  Заместване: "${substituteCol?.name ?? '—'}"  ТРЗ: "${tpzRespCol?.name ?? '—'}"  ТРЗ Статус: "${tpzStatusCol?.name ?? '—'}"`)

      if (!nameCol || !statusCol) throw new Error('Не намерих задължителните колони „Фирма" и „Статус"')

      // 2. Cache dropdown options; create missing ones on demand
      const dropdownCache = new Map<string, Map<string, string>>()

      async function getOrCreateOption(col: Column, value: string): Promise<string> {
        if (!dropdownCache.has(col.id)) {
          const opts = await getDropdownOptions(col.id)
          dropdownCache.set(col.id, new Map(opts.map(o => [o.value.toUpperCase(), o.id])))
        }
        const cache = dropdownCache.get(col.id)!
        const key = value.toUpperCase()
        if (cache.has(key)) return cache.get(key)!
        log(`  + Добавям опция "${value}" → "${col.name}"`)
        const newOpt = await addDropdownOption(col.id, value)
        cache.set(key, newOpt.id)
        return newOpt.id
      }

      // 3. Load existing clients and their name cells
      log('👥 Зареждам клиенти...')
      const [, nameCellsResult] = await Promise.all([
        getClients(),
        supabase.from('crm_cell_values').select('client_id,value_text').eq('column_id', nameCol.id),
      ])

      const clientByName = new Map<string, string>()
      for (const cell of nameCellsResult.data ?? []) {
        if (cell.value_text) clientByName.set(norm(cell.value_text), cell.client_id)
      }
      log(`  ${clientByName.size} клиента с имена в базата`)

      // 4. Create missing clients in batch
      const newRows = CSV_ROWS.filter(r => !clientByName.has(r.name))
      if (newRows.length > 0) {
        log(`➕ Създавам ${newRows.length} нови клиента...`)
        const { data: created, error } = await supabase
          .from('crm_clients')
          .insert(newRows.map(() => ({ created_by: user?.id ?? null, deleted: false })))
          .select('id')
        if (error) throw error
        created?.forEach((c, i) => clientByName.set(newRows[i].name, c.id))
      } else {
        log('  Всички клиенти вече съществуват')
      }

      // 5. Build desired cell value records
      log('🔧 Подготвям стойности...')
      const desired: CellRecord[] = []

      for (const row of CSV_ROWS) {
        const clientId = clientByName.get(row.name)
        if (!clientId) continue

        const addText = (col: Column | undefined, val: string) => {
          if (!col || !val) return
          desired.push({ client_id: clientId, column_id: col.id, value_text: val, value_number: null, value_date: null, value_bool: null, value_dropdown: null })
        }

        const addDropdown = async (col: Column | undefined, val: string) => {
          if (!col || !val) return
          if (col.type === 'dropdown') {
            const optId = await getOrCreateOption(col, val)
            desired.push({ client_id: clientId, column_id: col.id, value_text: null, value_number: null, value_date: null, value_bool: null, value_dropdown: optId })
          } else {
            addText(col, val)
          }
        }

        // Name (always text)
        desired.push({ client_id: clientId, column_id: nameCol.id, value_text: row.name, value_number: null, value_date: null, value_bool: null, value_dropdown: null })

        await addDropdown(statusCol, row.status)
        addText(accountantCol, row.accountant)
        addText(substituteCol, row.substitute)
        addText(tpzRespCol, row.tpzResp)
        await addDropdown(tpzStatusCol, row.tpzStatus)
      }

      log(`  ${desired.length} стойности подготвени`)

      // 6. Fetch existing cells to split into inserts vs updates
      const allClientIds = [...new Set(desired.map(r => r.client_id))]
      const allColIds = [...new Set(desired.map(r => r.column_id))]

      const { data: existingCells } = await supabase
        .from('crm_cell_values')
        .select('id,client_id,column_id')
        .in('client_id', allClientIds)
        .in('column_id', allColIds)

      const existingMap = new Map<string, string>()
      existingCells?.forEach(c => existingMap.set(`${c.client_id}:${c.column_id}`, c.id))

      const toInsert = desired.filter(r => !existingMap.has(`${r.client_id}:${r.column_id}`))
      const toUpdate = desired.filter(r => existingMap.has(`${r.client_id}:${r.column_id}`))
      log(`  Нови: ${toInsert.length}  Обновяване: ${toUpdate.length}`)

      // 7. Batch insert new cells
      if (toInsert.length > 0) {
        log('⬆️  Записвам нови стойности...')
        const CHUNK = 100
        for (let i = 0; i < toInsert.length; i += CHUNK) {
          const { error } = await supabase.from('crm_cell_values').insert(toInsert.slice(i, i + CHUNK))
          if (error) throw error
        }
      }

      // 8. Parallel-update existing cells (20 at a time)
      if (toUpdate.length > 0) {
        log('✏️  Обновявам съществуващи стойности...')
        const PARALLEL = 20
        for (let i = 0; i < toUpdate.length; i += PARALLEL) {
          const batch = toUpdate.slice(i, i + PARALLEL)
          const results = await Promise.all(
            batch.map(r => {
              const id = existingMap.get(`${r.client_id}:${r.column_id}`)!
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { client_id: _c, column_id: _col, ...updates } = r
              return supabase.from('crm_cell_values').update(updates).eq('id', id)
            })
          )
          const failed = results.find(r => r.error)
          if (failed?.error) throw failed.error
        }
        log(`  Обновени ${toUpdate.length} стойности`)
      }

      log('✅ Импортирането завърши успешно!')
      setPhase('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`❌ Грешка: ${msg}`)
      setPhase('idle')
    }
  }

  async function runEikImport() {
    setEikPhase('running')
    setEikLogs([])
    const log = (msg: string) => setEikLogs(prev => [...prev, msg])

    try {
      // 1. Find the name column ID
      log('👥 Зареждам клиентски имена...')
      const { data: cols, error: colErr } = await supabase
        .from('crm_columns')
        .select('id')
        .eq('type', 'text')
        .order('position')
        .limit(1)
      if (colErr) throw colErr
      const nameColId = cols?.[0]?.id
      if (!nameColId) throw new Error('Не намерих колона за имена')

      // 2. Fetch all name cells (filtered only by column, no large .in() list)
      const { data: nameCells, error: nameErr } = await supabase
        .from('crm_cell_values')
        .select('client_id,value_text')
        .eq('column_id', nameColId)
      if (nameErr) throw nameErr
      log(`  ${nameCells?.length ?? 0} имена заредени`)

      // 3. Build two lookup maps: exact and entity-stripped
      const exactMap = new Map<string, string>()    // normForEik(crmName) → clientId
      const strippedMap = new Map<string, string>() // stripped(normForEik(crmName)) → clientId

      for (const cell of nameCells ?? []) {
        if (!cell.value_text) continue
        const normed = normForEik(cell.value_text)
        const stripped = stripEntityIterative(normed)
        exactMap.set(normed, cell.client_id)
        if (!strippedMap.has(stripped)) strippedMap.set(stripped, cell.client_id)
      }

      // 4. Match each EIK entry
      const matched: { clientId: string; eik: string; displayName: string }[] = []
      const unmatched: string[] = []

      for (const entry of EIK_DATA) {
        const resolvedName = EIK_ALIASES[entry.name] ?? entry.name
        const normed = normForEik(resolvedName)
        const stripped = stripEntityIterative(normed)
        const clientId = exactMap.get(normed) ?? strippedMap.get(stripped)
        if (clientId) {
          matched.push({ clientId, eik: entry.eik, displayName: entry.name })
        } else {
          unmatched.push(entry.name)
        }
      }

      log(`  Намерени: ${matched.length}  Ненамерени: ${unmatched.length}`)
      if (unmatched.length > 0) {
        log('⚠️ Ненамерени клиенти:')
        unmatched.forEach(n => log(`  · ${n}`))
      }

      // 5. Check which matched clients already have a contact record
      log('🔍 Проверявам съществуващи контакти...')
      const matchedClientIds = matched.map(m => m.clientId)
      const { data: existingContacts, error: contactErr } = await supabase
        .from('crm_contacts')
        .select('id,client_id')
        .in('client_id', matchedClientIds)
      if (contactErr) throw contactErr

      const existingContactMap = new Map<string, string>() // clientId → contactId
      for (const c of existingContacts ?? []) {
        existingContactMap.set(c.client_id, c.id)
      }

      const toUpdate = matched.filter(m => existingContactMap.has(m.clientId))
      const toInsert = matched.filter(m => !existingContactMap.has(m.clientId))
      log(`  Обновяване: ${toUpdate.length}  Нови контакти: ${toInsert.length}`)

      // 6. Insert new contact rows (only client_id + eik)
      if (toInsert.length > 0) {
        log('➕ Създавам нови контакти...')
        const { error } = await supabase.from('crm_contacts').insert(
          toInsert.map(m => ({ client_id: m.clientId, eik: m.eik, created_by: user?.id ?? null }))
        )
        if (error) throw error
      }

      // 7. Update existing contacts — set only the eik field (20 in parallel)
      if (toUpdate.length > 0) {
        log('✏️  Обновявам ЕИК...')
        const PARALLEL = 20
        for (let i = 0; i < toUpdate.length; i += PARALLEL) {
          const batch = toUpdate.slice(i, i + PARALLEL)
          const results = await Promise.allSettled(
            batch.map(m =>
              supabase
                .from('crm_contacts')
                .update({ eik: m.eik })
                .eq('id', existingContactMap.get(m.clientId)!)
            )
          )
          const failed = results.find(
            r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)
          )
          if (failed) {
            const err =
              failed.status === 'rejected'
                ? failed.reason
                : (failed as PromiseFulfilledResult<{ error: Error }>).value.error
            throw err
          }
        }
        log(`  Обновени ${toUpdate.length} ЕИК-а`)
      }

      log('✅ ЕИК импортирането завърши успешно!')
      setEikPhase('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`❌ Грешка: ${msg}`)
      setEikPhase('idle')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-10">
      {/* ── Client import ── */}
      <section>
        <h1 className="text-xl md:text-2xl font-bold text-foreground mb-1">Импорт на клиенти</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {CSV_ROWS.length} реда · Съществуващите клиенти се обновяват, нови се добавят.
        </p>

        {phase !== 'running' && phase !== 'done' && (
          <button
            onClick={runImport}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition text-sm font-medium"
          >
            Стартирай импорт
          </button>
        )}

        {phase === 'running' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Импортиране в процес...
          </div>
        )}

        {logs.length > 0 && (
          <div className="mt-5 bg-muted/30 rounded-lg border border-border p-4 space-y-0.5 max-h-96 overflow-y-auto font-mono text-xs leading-relaxed">
            {logs.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.startsWith('❌') ? 'text-red-500' :
                  msg.startsWith('✅') ? 'text-green-600 dark:text-green-400 font-semibold' :
                  'text-foreground/75'
                }
              >
                {msg}
              </div>
            ))}
          </div>
        )}

        {phase === 'done' && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-sm font-medium">
            Готово! <a href="#/clients" className="underline">Виж клиентите →</a>
          </div>
        )}
      </section>

      <div className="border-t border-border" />

      {/* ── EIK import ── */}
      <section>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mb-1">Импорт на ЕИК</h2>
        <p className="text-sm text-muted-foreground mb-6">
          {EIK_DATA.length} записа · Съпоставя по име и записва ЕИК в контактите на клиента.
        </p>

        {eikPhase !== 'running' && eikPhase !== 'done' && (
          <button
            onClick={runEikImport}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition text-sm font-medium"
          >
            Импортирай ЕИК
          </button>
        )}

        {eikPhase === 'running' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Импортиране в процес...
          </div>
        )}

        {eikLogs.length > 0 && (
          <div className="mt-5 bg-muted/30 rounded-lg border border-border p-4 space-y-0.5 max-h-96 overflow-y-auto font-mono text-xs leading-relaxed">
            {eikLogs.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.startsWith('❌') ? 'text-red-500' :
                  msg.startsWith('✅') ? 'text-green-600 dark:text-green-400 font-semibold' :
                  msg.startsWith('⚠️') ? 'text-yellow-600 dark:text-yellow-400' :
                  'text-foreground/75'
                }
              >
                {msg}
              </div>
            ))}
          </div>
        )}

        {eikPhase === 'done' && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-sm font-medium">
            Готово! <a href="#/contacts" className="underline">Виж контактите →</a>
          </div>
        )}
      </section>
    </div>
  )
}
