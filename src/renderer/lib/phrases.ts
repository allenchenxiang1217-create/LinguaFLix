/**
 * 词组 / 固定搭配表（#5 自动识别）。
 *
 * 内置 ~280 条精选高频英语搭配与短语动词，每条带中文释义。作用有二：
 *   1. 离线兜底释义：dict-gloss 查词无果时回退到这里，词组在单词本/闪卡/搜索里
 *      也有释义可看（ECDICT 精简库基本不含多词词条，在线服务又不保证每词命中）。
 *   2. 驱动句子里的词组识别：NoteSnapshotCard 把句子分词后按「最长优先」扫描本表，
 *      命中即渲染成单个可点击词组 chip（如 give up / in order to），点击后按词组
 *      查词典、存生词。
 *
 * 约定：只收录 ≥2 个词的固定搭配/短语动词；不收录含所有格、代词变量的形式
 * （如 catch one's eye 无法在句中稳定匹配）；释义为面向学习者的精炼中文。
 */

export interface Phrase {
  text: string
  zh: string
}

/** [词组, 中文释义]。按「最常用在前」排序；同长词组间顺序不影响匹配（见 findPhrases）。 */
const RAW: Array<[string, string]> = [
  // ── 短语动词（高频） ──
  ['give up', '放弃'],
  ['give in', '屈服'],
  ['give back', '归还'],
  ['give away', '赠送'],
  ['give out', '分发'],
  ['give birth to', '生下'],
  ['give way to', '让位于'],
  ['give a speech', '演讲'],
  ['look after', '照顾'],
  ['look for', '寻找'],
  ['look up', '查阅'],
  ['look into', '调查'],
  ['look out', '当心'],
  ['look forward to', '期待'],
  ['look down on', '看不起'],
  ['look at', '看'],
  ['take off', '起飞；脱下'],
  ['take on', '承担'],
  ['take up', '开始从事'],
  ['take over', '接管'],
  ['take part in', '参加'],
  ['take care of', '照顾'],
  ['take place', '发生'],
  ['take away', '带走'],
  ['take back', '收回'],
  ['take in', '吸收；欺骗'],
  ['take out', '取出'],
  ['take into account', '考虑到'],
  ['take advantage of', '利用'],
  ['take it easy', '别紧张'],
  ['take a break', '休息一下'],
  ['take a look', '看一看'],
  ['take a walk', '散步'],
  ['take a nap', '小睡片刻'],
  ['take a shower', '洗澡'],
  ['take notes', '记笔记'],
  ['put off', '推迟'],
  ['put on', '穿上'],
  ['put up with', '忍受'],
  ['put away', '收拾'],
  ['put out', '熄灭'],
  ['put down', '放下；记下'],
  ['put together', '组装'],
  ['put forward', '提出'],
  ['turn on', '打开'],
  ['turn off', '关闭'],
  ['turn up', '出现'],
  ['turn down', '拒绝；调低'],
  ['turn out', '结果是'],
  ['turn into', '变成'],
  ['turn around', '转身；扭转'],
  ['come up with', '想出'],
  ['come across', '偶然遇到'],
  ['come back', '回来'],
  ['come in', '进来'],
  ['come out', '出版；出现'],
  ['come true', '实现'],
  ['come to an end', '结束'],
  ['come into being', '形成'],
  ['come to life', '活跃起来'],
  ['find out', '查明'],
  ['point out', '指出'],
  ['work out', '解决；锻炼'],
  ['figure out', '弄清楚'],
  ['carry on', '继续'],
  ['carry out', '执行'],
  // ── 动词 + it + 小品词（日常高频，如 give it back / figure it out） ──
  ['give it back', '把它还回去'],
  ['give it up', '放弃它；交出'],
  ['figure it out', '把它弄清楚'],
  ['work it out', '把它解决'],
  ['point it out', '把它指出来'],
  ['bring it up', '把它提出来'],
  ['take it off', '把它脱下/取下'],
  ['take it back', '把它收回'],
  ['turn it on', '把它打开'],
  ['turn it off', '把它关掉'],
  ['put it on', '把它穿上'],
  ['put it off', '把它推迟'],
  ['pick it up', '把它捡起来'],
  ['throw it away', '把它扔掉'],
  ['try it on', '试穿它'],
  ['look it up', '查一查它'],
  ['break down', '抛锚；崩溃'],
  ['break up', '分手；解散'],
  ['break out', '爆发'],
  ['bring up', '抚养；提出'],
  ['bring about', '导致'],
  ['bring back', '带回'],
  ['check in', '办理入住/登机'],
  ['check out', '结账退房；查看'],
  ['check up on', '检查'],
  ['call off', '取消'],
  ['call on', '拜访；号召'],
  ['call back', '回电'],
  ['calm down', '冷静下来'],
  ['clean up', '清理'],
  ['cut off', '切断'],
  ['cut down on', '削减'],
  ['drop by', '顺路拜访'],
  ['drop off', '下车；放下'],
  ['drop out', '辍学'],
  ['end up', '最终'],
  ['get along', '相处'],
  ['get back', '回来'],
  ['get over', '克服'],
  ['get rid of', '摆脱'],
  ['get through', '通过；接通'],
  ['get up', '起床'],
  ['get in', '进入；上车'],
  ['get out', '出去'],
  ['get off', '下车'],
  ['get on', '上车'],
  ['get to know', '逐渐了解'],
  ['get in touch with', '与…联系'],
  ['get used to', '习惯'],
  ['get ready', '准备好'],
  ['get started', '开始'],
  ['go on', '继续'],
  ['go ahead', '继续吧'],
  ['go back', '回去'],
  ['go through', '经历'],
  ['go over', '复习'],
  ['go up', '上升'],
  ['go down', '下降'],
  ['go out', '外出'],
  ['go for', '努力争取'],
  ['grow up', '长大'],
  ['hang out', '闲逛'],
  ['hold on', '等一下'],
  ['keep on', '继续'],
  ['keep up', '跟上'],
  ['keep in mind', '记住'],
  ['keep track of', '跟踪'],
  ['keep in touch', '保持联系'],
  ['keep an eye on', '留意'],
  ['knock down', '撞倒'],
  ['leave out', '遗漏'],
  ['let down', '使失望'],
  ['let go', '放手'],
  ['make up', '编造；化妆'],
  ['make out', '辨认'],
  ['make sure', '确保'],
  ['make sense', '有意义'],
  ['make friends', '交朋友'],
  ['make a decision', '做决定'],
  ['make a difference', '产生影响'],
  ['make a mistake', '犯错'],
  ['make a living', '谋生'],
  ['make use of', '利用'],
  ['make up for', '弥补'],
  ['make the most of', '充分利用'],
  ['make fun of', '取笑'],
  ['pay back', '偿还'],
  ['pay for', '支付'],
  ['pay attention to', '注意'],
  ['pay a visit to', '拜访'],
  ['pick up', '捡起；接人'],
  ['pick out', '挑选'],
  ['pull up', '停下'],
  ['run out of', '用尽'],
  ['run into', '偶然遇到'],
  ['run away', '逃跑'],
  ['run for', '竞选'],
  ['set up', '建立'],
  ['set off', '出发；引爆'],
  ['set out', '出发'],
  ['set aside', '留出'],
  ['show up', '出现'],
  ['show off', '炫耀'],
  ['shut down', '关闭；停业'],
  ['sit down', '坐下'],
  ['stand up', '站起来'],
  ['stand for', '代表'],
  ['stand out', '突出'],
  ['stay up', '熬夜'],
  ['stick to', '坚持'],
  ['switch on', '打开'],
  ['switch off', '关闭'],
  ['throw away', '扔掉'],
  ['try on', '试穿'],
  ['try out', '试用'],
  ['wake up', '醒来'],
  ['warm up', '热身'],
  ['watch out', '当心'],
  ['work on', '致力于'],
  ['work for', '为…工作'],
  ['wrap up', '结束；包装'],
  ['catch up with', '赶上'],
  ['keep up with', '跟上'],
  ['fall asleep', '睡着'],
  ['fall behind', '落后'],
  ['fall apart', '崩溃'],
  ['fall in love with', '爱上'],
  ['fall in love', '坠入爱河'],
  ['tend to', '倾向于'],
  ['seem to', '似乎'],
  ['happen to', '碰巧'],
  ['used to', '过去常常'],
  ['ought to', '应该'],
  ['need to', '需要'],
  ['want to', '想要'],
  ['have to', '不得不'],
  ['had better', '最好'],
  ['would rather', '宁愿'],
  ['be able to', '能够'],
  ['be about to', '即将'],
  ['be going to', '将要'],
  ['be supposed to', '应该'],
  ['be willing to', '愿意'],
  ['be aware of', '意识到'],
  ['be afraid of', '害怕'],
  ['be proud of', '为…自豪'],
  ['be fond of', '喜欢'],
  ['be interested in', '对…感兴趣'],
  ['be good at', '擅长'],
  ['be bad for', '对…有害'],
  ['be responsible for', '对…负责'],
  ['be familiar with', '熟悉'],
  ['be similar to', '与…相似'],
  ['be different from', '与…不同'],
  ['be full of', '充满'],
  ['be tired of', '厌倦'],
  ['be late for', '迟到'],
  ['be ready for', '准备好'],
  ['be short of', '缺乏'],
  ['be up to', '取决于'],
  // ── 介词短语 / 固定搭配 ──
  ['as well as', '以及；同样'],
  ['as soon as', '一…就…'],
  ['as long as', '只要'],
  ['as far as', '就…而言'],
  ['as if', '好像'],
  ['as usual', '像往常一样'],
  ['as a result', '因此'],
  ['as a whole', '整体上'],
  ['as for', '至于'],
  ['as to', '关于'],
  ['at least', '至少'],
  ['at most', '至多'],
  ['at once', '立刻'],
  ['at present', '目前'],
  ['at the same time', '同时'],
  ['at the moment', '此刻'],
  ['at first', '起初'],
  ['at last', '终于'],
  ['at all', '根本；究竟'],
  ['at times', '有时'],
  ['at ease', '自在'],
  ['at risk', '有风险'],
  ['at stake', '处于危险中'],
  ['by the way', '顺便说'],
  ['by accident', '偶然'],
  ['by chance', '碰巧'],
  ['by heart', '凭记忆'],
  ['by means of', '通过…方式'],
  ['by no means', '绝不'],
  ['by far', '显然'],
  ['by hand', '手工'],
  ['by now', '到现在'],
  ['in order to', '为了'],
  ['in order that', '以便'],
  ['in fact', '事实上'],
  ['in general', '总的来说'],
  ['in particular', '尤其'],
  ['in addition', '此外'],
  ['in addition to', '除…之外'],
  ['in advance', '提前'],
  ['in charge of', '负责'],
  ['in common', '共同'],
  ['in conclusion', '总之'],
  ['in contrast', '相比之下'],
  ['in detail', '详细地'],
  ['in front of', '在…前面'],
  ['in the end', '最后'],
  ['in the meantime', '与此同时'],
  ['in the middle of', '在…中间'],
  ['in the way', '挡路'],
  ['in time', '及时'],
  ['in total', '总共'],
  ['in trouble', '处于困境'],
  ['in turn', '依次'],
  ['in vain', '徒劳'],
  ['in other words', '换句话说'],
  ['in my opinion', '在我看来'],
  ['in terms of', '就…而言'],
  ['in case', '以防'],
  ['in a hurry', '匆忙'],
  ['in a word', '总之'],
  ['in public', '公开'],
  ['in private', '私下'],
  ['in return', '作为回报'],
  ['in spite of', '尽管'],
  ['instead of', '而不是'],
  ['on behalf of', '代表'],
  ['on the other hand', '另一方面'],
  ['on the one hand', '一方面'],
  ['on time', '准时'],
  ['on purpose', '故意'],
  ['on average', '平均'],
  ['on business', '出差'],
  ['on duty', '值班'],
  ['on foot', '步行'],
  ['on sale', '出售；打折'],
  ['on the whole', '大体上'],
  ['on the contrary', '相反'],
  ['on top of', '在…上面'],
  ['on demand', '按需'],
  ['out of order', '出故障'],
  ['out of date', '过时'],
  ['out of control', '失控'],
  ['out of reach', '够不着'],
  ['out of the question', '不可能'],
  ['out of breath', '上气不接下气'],
  ['out of place', '不合适'],
  ['of course', '当然'],
  ['of all time', '有史以来'],
  ['for example', '例如'],
  ['for instance', '例如'],
  ['for the first time', '第一次'],
  ['for the time being', '暂时'],
  ['for good', '永久地'],
  ['for sure', '肯定'],
  ['for the sake of', '为了…'],
  ['to be honest', '说实话'],
  ['to sum up', '总之'],
  ['to some extent', '在某种程度上'],
  ['to the point', '切题'],
  ['thanks to', '多亏'],
  ['due to', '由于'],
  ['according to', '根据'],
  ['regardless of', '不管'],
  ['apart from', '除了'],
  ['except for', '除了'],
  ['along with', '连同'],
  ['together with', '和…一起'],
  ['more or less', '或多或少'],
  ['sooner or later', '迟早'],
  ['now and then', '偶尔'],
  ['here and there', '到处'],
  ['up to date', '最新'],
  ['all over', '到处'],
  ['all along', '一直'],
  ['all the time', '一直'],
  ['all the way', '一路'],
  ['no wonder', '难怪'],
  ['no doubt', '无疑'],
  ['not at all', '一点也不'],
  ['a lot of', '许多'],
  ['a couple of', '几个'],
  ['a great deal of', '大量'],
  ['a number of', '许多'],
  ['a variety of', '各种各样的'],
  ['a series of', '一系列'],
  ['a sense of', '一种…感'],
  ['a matter of', '关乎…的问题'],
  ['a waste of time', '浪费时间'],
]

export const PHRASES: Phrase[] = RAW.map(([text, zh]) => ({ text, zh }))

/** text（小写）→ Phrase，O(1) 查找。 */
export const PHRASE_BY_KEY = new Map<string, Phrase>()
for (const p of PHRASES) PHRASE_BY_KEY.set(p.text.toLowerCase(), p)

/** 按单词数降序：最长优先匹配，保证「as well as」先于「as well」。 */
const PHRASES_SORTED = [...PHRASES].sort((a, b) => b.text.split(' ').length - a.text.split(' ').length)

/** 取某词/词组对应的精选释义（小写 key）。 */
export function getPhraseGloss(text: string): Phrase | undefined {
  return PHRASE_BY_KEY.get(text.trim().toLowerCase())
}

/** 常用不规则动词过去/分词形式 → 词根（让 gave up / took off 也能命中 give up / take off）。 */
const IRREG: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  goes: 'go', went: 'go', gone: 'go', going: 'go',
  gives: 'give', gave: 'give', given: 'give', giving: 'give',
  takes: 'take', took: 'take', taken: 'take', taking: 'take',
  makes: 'make', made: 'make', making: 'make',
  comes: 'come', came: 'come', coming: 'come',
  gets: 'get', got: 'get', gotten: 'get', getting: 'get',
  runs: 'run', ran: 'run', running: 'run',
  breaks: 'break', broke: 'break', broken: 'break', breaking: 'break',
  brings: 'bring', brought: 'bring', bringing: 'bring',
  puts: 'put', putting: 'put',
  sets: 'set', setting: 'set',
  finds: 'find', found: 'find', finding: 'find',
  holds: 'hold', held: 'hold', holding: 'hold',
  stands: 'stand', stood: 'stand', standing: 'stand',
  sits: 'sit', sat: 'sit', sitting: 'sit',
  cuts: 'cut', cutting: 'cut',
  draws: 'draw', drew: 'draw', drawn: 'draw', drawing: 'draw',
  pays: 'pay', paid: 'pay', paying: 'pay',
  says: 'say', said: 'say', saying: 'say',
  thinks: 'think', thought: 'think', thinking: 'think',
  keeps: 'keep', kept: 'keep', keeping: 'keep',
  feels: 'feel', felt: 'feel', feeling: 'feel',
  sends: 'send', sent: 'send', sending: 'send',
  leaves: 'leave', left: 'leave', leaving: 'leave',
  falls: 'fall', fell: 'fall', fallen: 'fall', falling: 'fall',
  grows: 'grow', grew: 'grow', grown: 'grow', growing: 'grow',
  knows: 'know', knew: 'know', known: 'know', knowing: 'know',
  shows: 'show', showed: 'show', shown: 'show', showing: 'show',
  tells: 'tell', told: 'tell', telling: 'tell',
  wins: 'win', won: 'win', winning: 'win',
  loses: 'lose', lost: 'lose', losing: 'lose',
  hears: 'hear', heard: 'hear', hearing: 'hear',
  wears: 'wear', wore: 'wear', worn: 'wear', wearing: 'wear',
  leads: 'lead', led: 'lead', leading: 'lead',
  meets: 'meet', met: 'meet', meeting: 'meet',
  spends: 'spend', spent: 'spend', spending: 'spend',
  builds: 'build', built: 'build', building: 'build',
  learns: 'learn', learned: 'learn', learnt: 'learn', learning: 'learn',
  buys: 'buy', bought: 'buy', buying: 'buy',
  catches: 'catch', caught: 'catch', catching: 'catch',
  teaches: 'teach', taught: 'teach', teaching: 'teach',
  fights: 'fight', fought: 'fight', fighting: 'fight',
  sees: 'see', saw: 'see', seeing: 'see',
  begins: 'begin', began: 'begin', begun: 'begin', beginning: 'begin',
}

/** 把一个句子 token 归并到「可匹配词干」：不规则动词查表，规则 -s/-es/-ed/-ing 回退。 */
function stemToken(tok: string): string {
  const lower = tok.toLowerCase()
  if (IRREG[lower]) return IRREG[lower]
  if (lower.length < 3) return lower
  if (lower.endsWith('ing')) {
    let base = lower.slice(0, -3)
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) base = base.slice(0, -1)
    return base
  }
  if (lower.endsWith('ies')) return lower.slice(0, -3) + 'y'
  if (lower.endsWith('ied')) return lower.slice(0, -3) + 'y' // carried → carry, studied → study
  if (lower.endsWith('ed')) {
    let base = lower.slice(0, -2)
    if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) base = base.slice(0, -1)
    return base
  }
  if (lower.endsWith('es')) return lower.slice(0, -2)
  if (lower.endsWith('s')) return lower.slice(0, -1)
  return lower
}

export type SentenceSegment =
  | { type: 'phrase'; text: string; raw: string }
  | { type: 'word'; text: string; raw: string }

/**
 * 把一句话切成「单词 / 词组」段：#5 自动识别固定搭配。
 *
 * - raw 是句子里原本的写法（保留大小写与前后标点，如 "gave up,"），用于显示；
 * - text 是规范形式（词组的词根原文，如 "give up"；单词的干净形式），用于点击/查词/保存。
 * - 匹配走词干归并，所以 "gave up" / "took off" 都能命中词根词条。
 */
export function findPhrases(sentence: string): SentenceSegment[] {
  const rawTokens = sentence.split(' ')
  const stems = rawTokens.map((w) => stemToken(w.replace(/[^a-zA-Z'-]/g, '')))
  const out: SentenceSegment[] = []
  let i = 0
  while (i < rawTokens.length) {
    const clean = rawTokens[i].replace(/[^a-zA-Z'-]/g, '')
    // 先试词组匹配（最长优先：从高单词数往下试，第一个命中即当前窗口最优）。
    // 单字符 token（a/an/I）也可能是词组起点（如 a lot of），不能提前短路。
    let matched: Phrase | null = null
    let matchedLen = 0
    for (const p of PHRASES_SORTED) {
      const n = p.text.split(' ').length
      if (i + n > stems.length) continue
      if (stems.slice(i, i + n).join(' ') === p.text.toLowerCase()) {
        matched = p
        matchedLen = n
        break
      }
    }
    if (matched) {
      out.push({ type: 'phrase', text: matched.text, raw: rawTokens.slice(i, i + matchedLen).join(' ') })
      i += matchedLen
      continue
    }
    out.push({ type: 'word', text: clean, raw: rawTokens[i] })
    i++
  }
  return out
}
