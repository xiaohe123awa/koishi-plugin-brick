import { Context, Schema, Random, h, $ } from 'koishi'

export const name = 'brick'

export const usage = `更新日志：https://forum.koishi.xyz/t/topic/9593  
烧制砖块，然后拍晕群友！  
如果机器人没有禁言的权限，将改为停止响应被拍晕的用户相同时间！  
开始烧制之后，群内其他群友发送一定数量的消息就能完成烧制！  
烧出来的砖头不能跨群用哦！  `

export interface Brick {
  id: number
  userId: string
  guildId: string
  brick: number
  burning: boolean
  lastSlap: number
  checkingDay: string
}

declare module 'koishi' {
  interface Tables {
    brick: Brick
  }
}

export interface Config {
  maxBrick: number
  cost: number
  cooldown: number
  minMuteTime: number
  maxMuteTime: number
  reverse: number
  checking: boolean
  minGain?: number
  maxGain?: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    maxBrick: Schema.number()
      .default(1)
      .description('砖块最多持有量'),
    cost: Schema.number()
      .required()
      .description('多少条消息能烧好一块砖'),
    cooldown: Schema.number()
      .default(60)
      .description('拍砖冷却时间（秒）'),
    minMuteTime: Schema.number()
      .default(10)
      .description('最小禁言时间（秒）'),
    maxMuteTime: Schema.number()
      .default(120)
      .description('最大禁言时间（秒）'),
    reverse: Schema.number()
      .default(10)
      .description('反被拍晕的概率（%）'),
  }),

  Schema.object({
    checking: Schema.boolean()
      .default(false)
      .description('是否开启每日签到（获取随机数量的砖头）'),
  }),
  Schema.union([
    Schema.object({
      checking: Schema.const(true).required(),
      minGain: Schema.number().required().description('最小获取数量'),
      maxGain: Schema.number().required().description('最大获取数量'),
    }),
    Schema.object({
      checking: Schema.const(false)
    })
  ])

])

export const inject = ["database"]

export async function apply(ctx: Context, config: Config) {
  ctx.model.extend('brick', {
    id: 'unsigned',
    userId: 'string',
    guildId: 'string',
    brick: 'unsigned',
    burning: 'boolean',
    lastSlap: 'unsigned',
    checkingDay: 'string'
  }, {primary: 'id', autoInc: true})

  await ctx.database.set('brick', {}, {
    burning: false,
  })
  
  ctx.command("砖头")

  ctx.command("砖头.烧砖", "烧点砖头拍人")
    .alias("烧砖")
    .action(async ({ session }) => {
      let user = await ctx.database.get('brick', {
        userId: session.userId, 
        guildId: session.guildId
      })

      if (user.length === 0) {
        await ctx.database.create('brick', {
          userId: session.userId, 
          guildId: session.guildId, 
          brick: 0
        })
      } else if (user[0].brick >= config.maxBrick) {
        return `你最多只能拥有${config.maxBrick}块砖`
      } else if (user[0].burning) {
        return `已经在烧砖了`
      }

      await ctx.database.set('brick', {
        userId: session.userId, 
        guildId: session.guildId
      }, {burning: true})

      await session.send(`现在开始烧砖啦，群友每发送${config.cost}条消息就烧好一块砖`)

      let messageCount = 0

      let dispose = ctx.guild(session.guildId).middleware(async (session_in, next) => {
        if (![session.userId, session.selfId].includes(session_in.userId)) {
          messageCount += 1

          if (messageCount >= config.cost) {
            dispose()

            await ctx.database.upsert('brick', (row) => [{
              userId: session.userId, 
              guildId: session.guildId, 
              brick: $.add(row.brick, 1), 
              burning: false
            }], ["userId", "guildId"])

            await session.send(`${h.at(session.userId)} 砖已经烧好啦`)
          }
        }

        return next()
      })

    })

  ctx.command("砖头.拍人 <user:user>", "拍晕（禁言）对方随机时间，有概率被反将一军", {checkArgCount: true})
    .alias("拍人")
    .example("拍人 @koishi")
    .action(async ({session}, user) => {
      let brickData = await ctx.database.get('brick', {
        userId: session.userId, 
        guildId: session.guildId
      })

      if (brickData.length === 0 || brickData[0].brick === 0) {
        return "你在这个群还没有砖头，使用 砖头.烧砖 烧点砖头吧"
      } 
      
      let diff = Math.trunc(Date.now() / 1000 - brickData[0].lastSlap)

      if (diff < config.cooldown) {
        return `${Math.abs(diff - config.cooldown)} 秒后才能再拍人哦`
      }

      await ctx.database.upsert('brick', (row) => [{
        userId: session.userId, 
        guildId: session.guildId, 
        brick: $.subtract(row.brick, 1),
        lastSlap: Date.now() / 1000
      }], ["userId", "guildId"])

      let [platform, targetUserId] = user.split(":")

      let muteTime = Random.int(config.minMuteTime, config.maxMuteTime)
      let muteTimeMs = muteTime * 1000

      if (Random.bool(config.reverse / 100)) {
        await session.bot.muteGuildMember(session.guildId, session.userId, muteTimeMs)
        silent(session.userId, muteTimeMs)
        return `${h.at(session.userId)} 对方夺过你的砖头，把你被拍晕了 ${muteTime} 秒`
      } else {
        await session.bot.muteGuildMember(session.guildId, targetUserId, muteTimeMs)
        silent(targetUserId, muteTimeMs)
        return `${h.at(targetUserId)} 你被 ${h.at(session.userId)} 拍晕了 ${muteTime} 秒`
      }

      function silent(userId: string, time: number) {
        let dispose = ctx.guild(session.guildId).middleware((session, next) => {
          if (session.userId !== userId) {
            return next()
          }
        }, true)

        ctx.setTimeout(() => {
          dispose()
        }, time)
      }
    })

  ctx.command("砖头.查看", "看看自己在这个群有多少砖头")
    .alias("查看砖头")
    .action(async ({session}) => {
      let brickData = await ctx.database.get('brick', {
        userId: session.userId, 
        guildId: session.guildId,
      })

      if (brickData.length === 0 || brickData[0].brick === 0) {
        return `你还没有砖头，使用 砖头.烧砖 烧点吧`
      } else {
        return `你有 ${brickData[0].brick}/${config.maxBrick} 块砖头`
      }
    })

  if (config.checking) {
    ctx.command("砖头.签到")
      .alias("砖头签到")
      .action(async ({session}) => {
        let date = new Date()
        let today = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
        let brick = Random.int(config.minGain, config.maxGain + 1)

        let userData = await ctx.database.get('brick', {
          userId: session.userId, 
          guildId: session.guildId,
        })

        if (userData.length === 0) {
          await ctx.database.create('brick', {
            userId: session.userId, 
            guildId: session.guildId,
            brick: brick,
            checkingDay: today
          })

          return `签到成功，你获得了 ${brick} 块砖头，你现在有${brick}/${config.maxBrick}块砖头`
        } else if (userData[0].brick >= config.maxBrick) {
          return `你的砖头已经到上限了，用掉再签到吧`
        } else if (userData[0].checkingDay !== today) {
          if (userData[0].brick + brick > config.maxBrick) {
            brick = config.maxBrick - userData[0].brick
          }

          await ctx.database.upsert('brick', (row) => [{
                  userId: session.userId,
                  guildId: session.guildId,
                  brick: $.add(row.brick, brick),
                  checkingDay: today
                }], ["userId", "guildId"])

          return `签到成功，获得了 ${brick} 块砖头，现在你有 ${userData[0].brick + brick}/${config.maxBrick} 块砖头`
        } else {
          return "你今天已经签到过了"
        }
      })
  }
}