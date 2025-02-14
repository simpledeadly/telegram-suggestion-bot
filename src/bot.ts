import { Telegraf } from 'telegraf'
import { callbackQuery } from 'telegraf/filters'
import chalk from 'chalk'
import { sequelize } from './database'
import { SuggestionModel } from './models/suggestion'

const bot = new Telegraf(process.env.BOT_TOKEN!)

const channelId = '-1002462309705' // ID of networkingFB channel
// const testChannelId = '-1002282641909' // ID of test channel
const moderationChannelId = '-1002325968351' // ID of moderation channel
const channelWithSuggestions = '-1002316616198' // ID of channelWithSuggestions channel
const channelWithMessagesFromUsers = '-1002368509706' // ID of channelWithMessagesFromUsers channel

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
let rejectedSuggestions: SuggestionWithStatus<'rejected'>[] = []

const authorizedUsers = [812999070, 7517081086, 2018873272]; // Я, Моё величество и Фарзин

(async () => {
  try {
    await sequelize.authenticate()
    console.log(chalk.hex('#2b67ff').bold('Подключение к базе данных успешно.'))
    
    // await sequelize.sync({ force: true })
    await sequelize.sync()
    console.log(chalk.hex('#2badff').bold('Модели синхронизированы.'))
  } catch (error) {
    console.error(chalk.hex('#ff1c1c').bold('Не удалось подключиться к базе данных:'), error)
  }
})()

bot.start((ctx) => {
  ctx.reply('Начните с /send <ваше_предложение>')
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

  const suggestionText = `Новое предложение (${suggestion.id}):\n\n${text}\n\nот @${suggestion.username} (${suggestion.userId})`

  if (suggestion.photoId && suggestion.photoId.length > 0) {
    bot.telegram.sendPhoto(moderationChannelId, suggestion.photoId, { ...options, caption: suggestionText })
      .catch(error => {
        console.error('Ошибка при отправке сообщения с фото:', error)
      })
  } else {
    bot.telegram.sendMessage(moderationChannelId, suggestionText, { ...options })
      .catch(error => {
        console.error('Ошибка при отправке сообщения:', error)
      })
  }
}

const handleInbox = (ctx: any, text: string, photoId?: string) => {
  const msg = ctx.message
  console.log('Entities:\n', msg.entities)

  const newSuggestion: SuggestionWithStatus<'pending'> = {
    id: Date.now(),
    userId: msg.from.id,
    username: msg.from.username,
    text,
    photoId
  }

  pendingSuggestions.push({ ...newSuggestion, status: 'pending' })

  ctx.reply(`*${'Предложение отправлено на модерацию'}* 💬\n\n_№${newSuggestion.id}_`, { parse_mode: 'Markdown' })
    .catch((e: Error) => {
      console.error('Ошибка при запуске бота:', e)
    })

  sendToModerators(newSuggestion, newSuggestion.text)
}

bot.command('send', (ctx) => {
  const msg = ctx.message
  const args = msg.text.split(' ')
  const suggestionContent = args.slice(1).join(' ')

  if (args.length < 2) {
    return ctx.reply('Отправьте предложение в формате:\n/send <ваше_предложение>\n\nМожно добавить фото, для этого отправьте предложение и фото одним сообщением')
  }

  try {
    handleInbox(ctx, suggestionContent)
  } catch (error) {
    console.error(error)
    return ctx.reply(`Ошибка: ${error}`)
  }
})

bot.on('photo', (ctx) => {
  const msg: any = ctx.message

  const errorMessage = 'Отправьте предложение с фото в формате:\n/send <предложение>'
  
  if (msg.caption) {
    const args = msg.caption.split(' ')
    const suggestionContent = args.slice(1).join(' ')
    
    if (args.length < 2) {
      return ctx.reply(errorMessage)
    }
    
    if (args[0] === '/send' && msg.caption && msg.photo && Array.isArray(msg.photo)) {
      const photoId = msg.photo[msg.photo.length - 1].file_id
      
      handleInbox(ctx, suggestionContent, photoId)
    } else {
      ctx.reply(errorMessage)
    }
  } else {
    ctx.reply(errorMessage)
  }
})

bot.command('comment', async (ctx) => {
  const msg = ctx.message
  const senderId = msg.from.id
  const args = msg.text.split(' ')
  
  if (authorizedUsers.includes(senderId)) {
    if (args.length < 3) {
      return ctx.reply('Отправьте в формате:\n/comment <ID> <сообщение>')
    }
  
    const userId = args[1]
    const comment = args.slice(2).join(' ')
  
    try {
      await ctx.telegram.sendMessage(userId, `*${'Новое сообщение от модератора:'}*\n${comment}`, { parse_mode: 'Markdown' }).then(() => {
        ctx.telegram.sendMessage(userId, 'Чтобы ответить используйте: /talk <сообщение>')
      })
      
      return ctx.reply(`Сообщение отправлено`)
    } catch (e) {
      console.error(e)
      return ctx.reply(`Ошибка при отправке сообщения: ${e}`)
    }
  } else {
    return ctx.reply(`*${'У вас нет прав для использования этой команды'}*`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Связаться с создателем', callback_data: `contact_${812999070}`, url: `https://t.me/simpledeadly` }
          ]
        ]
      }
    })
  }
})

bot.command('talk', async (ctx) => {
  const msg = ctx.message
  const args = msg.text.split(' ')
  const msgContent = args.slice(1).join(' ')

  const username = msg.from.username
  const userId = msg.from.id

  if (msgContent) {
    const message = `@${username} (${userId}):\n${msgContent}`

    await ctx.telegram.sendMessage(channelWithMessagesFromUsers, message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Ответить в боте', url: `https://t.me/networking_suggestion_bot` },
          ]
        ]
      }
    })
    
    ctx.reply('Сообщение отправлено')
  } else {
    ctx.reply('Отправьте в формате:\n/talk <сообщение>')
  }
})

bot.command('suggest', async (ctx) => {
  const msg = ctx.message
  const args = msg.text.split(' ')
  const msgContent = args.slice(1).join(' ')

  const username = msg.from.username
  const userId = msg.from.id

  if (msgContent) {
    const message = `@${username} (${userId}):\n${msgContent}`

    await ctx.telegram.sendMessage(channelWithSuggestions, message)
    
    ctx.reply('Предложение по развитию отправлено')
  } else {
    ctx.reply('Отправьте в формате:\n/suggest <предложение>')
  }
})

bot.command('donate', async (ctx) => {
  ctx.reply('Т-Банк: 5536 9139 0142 9064\n\nUSDT, BNB (BEP-20):\n0x359db439cF004e308E35051F20f999E1bD67824B\n\nUSDT, TON (TON):\nUQBFIZbG8N0dHqQ5lCv5F2Fxenx6jITo9Fk2wGY0pWPn2k31', { parse_mode: 'Markdown' })
})

bot.on('text', ctx => {
  ctx.reply('Используйте команды:\n/send — для отправки предложения\n/talk — для отправки сообщения модераторам\n/suggest — для предложений по боту, каналу\n/donate — для поддержки проекта')
})

bot.on(callbackQuery('data'), async (ctx) => {
  const callbackQuery = ctx.callbackQuery
  const msg: any = callbackQuery.message

  const action = callbackQuery.data.split('_')[0]
  const suggestionId = parseInt(callbackQuery.data.split('_')[1])

  const suggestion = pendingSuggestions.find(s => s.id === suggestionId)

  const editMessage = async (suggestion: Suggestion, result: 'Опубликовано' | 'Отклонено' | 'Стёрто') => {
    if (!msg) return
  
    const isPhoto = Boolean(suggestion.photoId)
    const currentContent = isPhoto ? msg.caption : msg.text
    if (!currentContent) return
    
    const args = currentContent.split(' ')
    const allExceptBeginning = args.slice(2, args.length)
    const updatedContent = 'Обработано ' + allExceptBeginning.join(' ')
  
    const statusIcon = result === 'Опубликовано' ? '\n\n☑️' : '\n\n🔘'
    const newContent = `${updatedContent}${statusIcon} ${result} @${ctx.from.username}`
  
    await (isPhoto
      ? ctx.editMessageCaption(newContent, {
          reply_markup: getReplyMarkup(suggestion),
        })
      : ctx.editMessageText(newContent, {
          reply_markup: getReplyMarkup(suggestion),
        })
    )
  }
  
  const getReplyMarkup = (suggestion: Suggestion) => ({
    inline_keyboard: [
      [
        { text: 'Связаться 🗣️', callback_data: `contact_${suggestion.id}`, url: `https://t.me/${suggestion.username}` }
      ]
    ]
  })

  const handleSuggestion = async (action: 'publish' | 'reject' | 'erase' , suggestion?: SuggestionWithStatus<'pending'>) => {
    if (!suggestion) {
      ctx.answerCbQuery('Предложение не может быть обработано')
      return
    }
    
    if (action === 'erase') {
      ctx.answerCbQuery('Предложение стёрто')

      pendingSuggestions = pendingSuggestions.filter(s => s.id !== suggestion.id)
      editMessage(suggestion, 'Стёрто')

      await ctx.telegram.sendMessage(suggestion.userId, `*${'Предложение'}*` + ` _№${suggestion.id}_ ` + `*${'стёрто'}* 🔘\n\nОтправьте новое предложение.`, { parse_mode: 'Markdown' })

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
      await ctx.telegram.sendMessage(suggestion.userId, `*${'Предложение опубликовано'}* ☑️\n\n_№${suggestion.id}_`, {
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
        notifyUser(await ctx.telegram.sendPhoto(channelId, suggestion.photoId, { caption: suggestion.text, parse_mode: 'Markdown' }))
      } else {
        notifyUser(await ctx.telegram.sendMessage(channelId, post))
      }
    } else {
      await ctx.telegram.sendMessage(suggestion.userId, `*${'Предложение отклонено'}* 🔘\n\n_№${suggestion.id}_`, { parse_mode: 'Markdown' })
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