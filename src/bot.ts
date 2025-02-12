import { Telegraf } from 'telegraf'
import { callbackQuery } from 'telegraf/filters'
import chalk from 'chalk'
import { sequelize } from './database'
import { SuggestionModel } from './models/suggestion'

const bot = new Telegraf(process.env.BOT_TOKEN!)

// const channelId = '-1002462309705' // ID of networkingFB channel
const testChannelId = '-1002282641909' // ID of test channel
const moderationChannelId = '-1002325968351' // ID of moderation channel

type Suggestion = {
  id: number
  userId: number
  username: string | undefined
  text: string
  status?: 'pending' | 'published' | 'rejected'
  photoId?: string
}

type SuggestionWithStatus<T extends Suggestion['status']> = Suggestion & { status?: T }


let publishedSuggestions: SuggestionWithStatus<'published'>[] = []
let pendingSuggestions: SuggestionWithStatus<'pending'>[] = []
let rejectedSuggestions: SuggestionWithStatus<'rejected'>[] = [];

(async () => {
  try {
    await sequelize.authenticate()
    console.log(chalk.hex('#2b67ff').bold('Подключение к базе данных успешно.'))
    
    // await sequelize.sync()
    await sequelize.sync({ force: true })
    console.log(chalk.hex('#2badff').bold('Модели синхронизированы.'))
  } catch (error) {
    console.error(chalk.hex('#ff1c1c').bold('Не удалось подключиться к базе данных:'), error)
  }
})()

bot.start((ctx) => {
  ctx.reply('Добро пожаловать! Отправьте ваши предложения.')
})

// const escapeMarkdown = (text: string) => {
//   return text.replace(/([_*[\]()~`>#+\-=|{}.!@])/g, '\\$1')
// }


const sendToModerators = (suggestion: Suggestion, text: string) => {
  const options = {
    reply_markup: {
      inline_keyboard: [
      [
          { text: '☑️', callback_data: `publish_${suggestion.id}` },
          { text: '🔘', callback_data: `reject_${suggestion.id}` },
          { text: '🧹', callback_data: `erase_${suggestion.id}` },
          { text: '🗣️', callback_data: `contact_${suggestion.id}`, url: `https://t.me/${suggestion.username}` }
        ]
      ]
    }
  }

  const suggestionText = `Новое предложение (№${suggestion.id}):\n\n${text}\n\nот @${suggestion.username}`

  if (suggestion.photoId && suggestion.photoId.length > 0) {
    bot.telegram.sendPhoto(moderationChannelId, suggestion.photoId, { ...options, caption: suggestionText })
      .catch(error => {
        console.error("Ошибка при отправке сообщения с фото:", error)
      })
  } else {
    bot.telegram.sendMessage(moderationChannelId, suggestionText, { ...options })
      .catch(error => {
        console.error("Ошибка при отправке сообщения:", error)
      })
  }
}

const handleInbox = (ctx: any, text: string, photoId?: string) => {
  const msg = ctx.message

  const newSuggestion: SuggestionWithStatus<'pending'> = {
    id: Date.now(),
    userId: msg.from.id,
    username: msg.from.username,
    text,
    photoId
  }

  pendingSuggestions.push({ ...newSuggestion, status: 'pending' })

  ctx.reply(`*${'Предложение отправлено на модерацию'}* 💬\n\n_№${newSuggestion.id}_`, { parse_mode: 'Markdown' })

  sendToModerators(newSuggestion, newSuggestion.text)
}

bot.on('photo', (ctx) => {
  const msg = ctx.message

  if (msg.caption && msg.photo && Array.isArray(msg.photo)) {
    const photoId = msg.photo[msg.photo.length - 1].file_id

    handleInbox(ctx, msg.caption, photoId)
  } else {
    ctx.reply('Пришлите описание и фото одним сообщением')
  }
})

bot.on('text', (ctx) => {
  const msg = ctx.message

  if (msg.text) {
    handleInbox(ctx, msg.text)
  }
})

bot.on(callbackQuery('data'), async (ctx) => {
  const callbackQuery = ctx.callbackQuery
  const msg: any = callbackQuery.message

  const action = callbackQuery.data.split('_')[0]
  const suggestionId = parseInt(callbackQuery.data.split('_')[1])

  const suggestion = pendingSuggestions.find(s => s.id === suggestionId)

  const editMessage = async (suggestion: Suggestion, result: 'Опубликовано' | 'Отклонено' | 'Стёрто') => {
    if (suggestion.photoId) {
      if (msg && msg.caption) {
        const currentCaption = msg.caption
        
        await ctx.editMessageCaption(`${currentCaption}${result === 'Опубликовано' ? '\n\n☑️' : '\n\n🔘'} ${result} @${ctx.from.username}`, {
          // parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Связаться 🗣️', callback_data: `contact_${suggestion.id}`, url: `https://t.me/${suggestion.username}` }
              ]
            ]
          }
        })
      }
    } else {
      if (msg && msg.text) {
        const currentText = msg.text

        await ctx.editMessageText(`${currentText}${result === 'Опубликовано' ? '\n\n☑️' : '\n\n🔘'} ${result} @${(ctx.from.username)}`, {
          // parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Связаться 🗣️', callback_data: `contact_${suggestion.id}`, url: `https://t.me/${suggestion.username}` }
              ]
            ]
          }
        })
      }
    }
  }

  const handleSuggestion = async (action: 'publish' | 'reject' | 'erase' , suggestion?: SuggestionWithStatus<'pending'>) => {
    if (!suggestion) {
      ctx.answerCbQuery('Предложение не может быть обработано')
      return
    }
    
    if (action === 'erase') {
      ctx.answerCbQuery('Предложение стёрто')

      pendingSuggestions = pendingSuggestions.filter(s => s.id !== suggestion.id)
      editMessage(suggestion, 'Стёрто')

      await bot.telegram.sendMessage(suggestion.userId, `*${'Предложение'}*` + ` _№${suggestion.id}_ ` + `*${'стёрто'}* 🔘\n\nОтправьте новое предложение.`, { parse_mode: 'Markdown' })

      return
    }
    
    const isPublish = action === 'publish'
    const status = isPublish ? 'published' : 'rejected'
    const message = isPublish ? 'Предложение опубликовано' : 'Предложение отклонено'
    
    ctx.answerCbQuery(message)

    try {
      const savedSuggestion = await SuggestionModel.create({ ...suggestion, status })

      console.log(chalk.hex('#ff671').bold(`${isPublish ? 'Опубликованное' : 'Отклонённое'} предложение сохранено:\n`), savedSuggestion)
    } catch (error) {
      console.error(chalk.hex('#ff0000').bold('Ошибка при сохранении предложения:'), error)

      ctx.sendPhoto('https://i.ytimg.com/vi/-jtJ4YUZQiw/hqdefault.jpg', {
        caption: `Не удалось обработать предложение...\nПроблема с базой данных`
      })

      if (isPublish) {
        publishedSuggestions.push({ ...suggestion, status: 'published' })
      } else {
        rejectedSuggestions.push({ ...suggestion, status: 'rejected' })
      }
    }

    pendingSuggestions = pendingSuggestions.filter(s => s.id !== suggestion.id)
    editMessage(suggestion, isPublish ? 'Опубликовано' : 'Отклонено')

    const post = `${suggestion.text}` // production template

    const notifyUser = async (suggestionPost: any) => {
      await bot.telegram.sendMessage(suggestion.userId, `*${'Предложение опубликовано'}* ☑️\n\n_№${suggestion.id}_`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Оно уже здесь', url: `https://t.me/c/2282641909/${suggestionPost.message_id}` }
            ]
          ]
        }
      })
    }

    if (isPublish) {
      if (suggestion.photoId) {
        notifyUser(await bot.telegram.sendPhoto(testChannelId, suggestion.photoId, { caption: suggestion.text, parse_mode: 'Markdown' }))
      } else {
        notifyUser(await bot.telegram.sendMessage(testChannelId, post))
      }
    } else {
      await bot.telegram.sendMessage(suggestion.userId, `*${'Предложение отклонено'}* 🔘\n\n_№${suggestion.id}_`, { parse_mode: 'Markdown' })
    }
    console.log(chalk.hex('#FFF')(`End:\n`), chalk.hex('#8B5DFF')('pending:'), pendingSuggestions, '\n', chalk.hex('#3D3BF3')(`not published in DB:`), publishedSuggestions, '\n', chalk.hex('#9694FF')(`not rejected in DB:`), rejectedSuggestions, '\n')
  }

  switch (action) {
    case 'publish':
    case 'reject':
    case 'erase':
      await handleSuggestion(action, suggestion)
      break
  }
})

bot.launch().catch(error => {
  console.error('Ошибка при запуске бота:', error)
})