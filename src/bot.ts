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
}

type SuggestionWithStatus<T extends Suggestion['status']> = Suggestion & { status?: T }


let publishedSuggestions: SuggestionWithStatus<'published'>[] = []
let pendingSuggestions: SuggestionWithStatus<'pending'>[] = []
let rejectedSuggestions: SuggestionWithStatus<'rejected'>[] = [];

(async () => {
  try {
    await sequelize.authenticate()
    console.log(chalk.hex('#2b67ff').bold('Подключение к базе данных успешно.'))
    
    await sequelize.sync()
    console.log(chalk.hex('#2badff').bold('Модели синхронизированы.'))
  } catch (error) {
    console.error(chalk.hex('#ff1c1c').bold('Не удалось подключиться к базе данных:'), error)
  }
})()

bot.start((ctx) => {
  ctx.reply('Добро пожаловать! Отправьте ваши предложения.')
})

bot.on('text', (ctx) => {
  const msg = ctx.message

  if (msg.text) {
    const newSuggestion: SuggestionWithStatus<'pending'> = {
      id: Date.now(),
      userId: msg.from.id,
      username: msg.from.username,
      text: msg.text
    }

    pendingSuggestions.push({ ...newSuggestion, status: 'pending' })

    console.log(chalk.hex('#FFF')(`Start:\n`), chalk.hex('#8B5DFF')('pending:'), pendingSuggestions, '\n', chalk.hex('#3D3BF3')(`published:`), publishedSuggestions, '\n', chalk.hex('#9694FF')(`rejected:`), rejectedSuggestions, '\n')

    ctx.reply(`*${'Предложение отправлено на модерацию'}* 💬\n\n_№${newSuggestion.id}_`, { parse_mode: 'Markdown' })

    sendToModerators(newSuggestion, `*${'Новое предложение'}*` + ` (_№${newSuggestion.id}):_\n\n${newSuggestion.text}\n\nот @${msg.from.username}`)
  }
})

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

  bot.telegram.sendMessage(moderationChannelId, text, { ...options, parse_mode: 'Markdown' })
}

bot.on(callbackQuery('data'), async (ctx) => {
  const callbackQuery = ctx.callbackQuery
  const msg: any = callbackQuery.message

  const action = callbackQuery.data.split('_')[0]
  const suggestionId = parseInt(callbackQuery.data.split('_')[1])

  const suggestion = pendingSuggestions.find(s => s.id === suggestionId)

  const editMessage = async (suggestion: Suggestion, result: 'Опубликовано' | 'Отклонено' | 'Стёрто') => {
    if (msg && msg.text) {
      const currentText = msg.text

      await ctx.editMessageText(`${currentText}${result === 'Опубликовано' ? '\n\n☑️' : '\n\n🔘'} *${`${result}`}* _${'by @' + ctx.from.username}_`, {
        parse_mode: 'Markdown',
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

  const handleSuggestion = async (action: 'publish' | 'reject' | 'erase' , suggestion?: SuggestionWithStatus<'pending'>) => {
    if (!suggestion) {
      ctx.answerCbQuery('Предложение не может быть обработано, оно было до обновления')
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

    if (isPublish) {
      const suggestionText = `${suggestion.text}` // production template
      const suggestionPost = await bot.telegram.sendMessage(testChannelId, suggestionText)

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
    } else {
      await bot.telegram.sendMessage(suggestion.userId, `*${'Предложение отклонено'}* 🔘\n\n_№${suggestion.id}_`, { parse_mode: 'Markdown' })
    }
  }

  switch (action) {
    case 'publish':
    case 'reject':
    case 'erase':
      await handleSuggestion(action, suggestion)
      console.log(chalk.hex('#FFF')(`End:\n`), chalk.hex('#8B5DFF')('pending:'), pendingSuggestions, '\n', chalk.hex('#3D3BF3')(`published:`), publishedSuggestions, '\n', chalk.hex('#9694FF')(`rejected:`), rejectedSuggestions, '\n')
      break
  }
})

bot.launch().catch(error => {
  console.error('Ошибка при запуске бота:', error)
})