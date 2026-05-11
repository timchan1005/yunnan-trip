// v29 — Hand-drawn map data
// 3-level hierarchy:
//   Level 0: Yunnan overview — Leaflet real map + ink-wash filter, 5 region GPS pins
//   Level 1: Region (city) — Leaflet real map fit to region bounds, spot GPS pins
//   Level 2: Spot detail — high-res watercolor close-up + pointer overlay (normalized 0-1)
//
// gps = [lat, lng] in WGS84.

window.MAP_DATA = {
  overview: {
    // Yunnan bounds approx, used to fit overview Leaflet map
    center: [26.6, 100.8],
    bounds: [[23.2, 97.5], [29.2, 105.7]],
    zoom: 6,
    regions: [
      { id: 'kunming',   name: '昆明',        gps: [25.04, 102.72], color: '#a8553d' },
      { id: 'dali',      name: '大理',        gps: [25.69, 100.16], color: '#b67a3a' },
      { id: 'lijiang',   name: '麗江',        gps: [26.87, 100.23], color: '#5d8c70' },
      { id: 'lugu',      name: '瀘沽湖',      gps: [27.71, 100.78], color: '#496c8c' },
      { id: 'shangrila', name: '香格里拉',    gps: [27.83, 99.71],  color: '#3d5275' },
    ],
  },
  regions: {
    kunming: {
      name: '昆明',
      subtitle: '滇池畔嘅春城',
      center: [25.0, 102.7],
      bounds: [[24.65, 102.40], [25.30, 103.35]],
      spots: [
        { id: 'day2-s1', name: '石林風景區',   gps: [24.795, 103.323], hasImg: true, day: 2 },
        { id: 'day2-s2', name: '撈魚河濕地',   gps: [24.755, 102.762], hasImg: true, day: 2 },
        { id: 'day2-s3', name: '昆明老街',     gps: [25.038, 102.708], hasImg: true, day: 2 },
        { id: 'day1-s2', name: '雙橋夜市',     gps: [25.022, 102.692], hasImg: true, day: 1 },
      ],
    },
    dali: {
      name: '大理',
      subtitle: '蒼山洱海 · 風花雪月',
      center: [25.85, 100.20],
      bounds: [[25.55, 99.95], [26.18, 100.45]],
      spots: [
        { id: 'day4-s1', name: '喜洲古鎮',     gps: [25.872, 100.122], hasImg: true, day: 4 },
        { id: 'day3-s3', name: '雙廊古鎮',     gps: [25.953, 100.180], hasImg: true, day: 3 },
        { id: 'day3-s4', name: '小普陀',       gps: [25.832, 100.198], hasImg: true, day: 3 },
        { id: 'day4-s3', name: '龍龕碼頭',     gps: [25.708, 100.183], hasImg: true, day: 4 },
        { id: 'day4-s4', name: '崇聖寺三塔',   gps: [25.713, 100.150], hasImg: true, day: 4 },
        { id: 'day4-s5', name: '大理古城',     gps: [25.692, 100.160], hasImg: true, day: 4 },
        { id: 'day3-s2', name: '理想邦',       gps: [25.755, 100.180], hasImg: true, day: 3 },
        { id: 'day4-s2', name: '周城扎染',     gps: [25.928, 100.140], hasImg: true, day: 4 },
      ],
    },
    lijiang: {
      name: '麗江',
      subtitle: '玉龍雪山 · 古城水鄉',
      center: [26.95, 100.20],
      bounds: [[26.55, 99.90], [27.30, 100.55]],
      spots: [
        { id: 'day6-s1', name: '玉龍雪山',     gps: [27.107, 100.198], hasImg: true, day: 6 },
        { id: 'day6-s2', name: '雲杉坪',       gps: [27.115, 100.207], hasImg: true, day: 6 },
        { id: 'day6-s3', name: '藍月谷',       gps: [27.092, 100.215], hasImg: true, day: 6 },
        { id: 'day6-s4', name: '白沙古鎮',     gps: [26.999, 100.230], hasImg: true, day: 6 },
        { id: 'day5-s1', name: '蒼山感通索道', gps: [25.640, 100.135], hasImg: true, day: 5 },
        { id: 'day5-s2', name: '寂照庵',       gps: [25.633, 100.137], hasImg: true, day: 5 },
        { id: 'day5-s3', name: '麗江古城',     gps: [26.874, 100.234], hasImg: true, day: 5 },
      ],
    },
    lugu: {
      name: '瀘沽湖',
      subtitle: '摩梭家園 · 走婚橋',
      center: [27.72, 100.82],
      bounds: [[27.55, 100.62], [27.92, 101.02]],
      spots: [
        { id: 'day7-s1', name: '瀘沽湖觀景台', gps: [27.685, 100.762], hasImg: true, day: 7 },
        { id: 'day7-s2', name: '里格村',       gps: [27.776, 100.785], hasImg: true, day: 7 },
        { id: 'day8-s1', name: '豬槽船晨霧',   gps: [27.728, 100.785], hasImg: true, day: 8 },
        { id: 'day8-s2', name: '草海走婚橋',   gps: [27.638, 100.857], hasImg: true, day: 8 },
      ],
    },
    shangrila: {
      name: '香格里拉',
      subtitle: '梅里日照金山 · 藏地秘境',
      center: [28.10, 99.30],
      bounds: [[27.30, 98.60], [28.85, 100.05]],
      spots: [
        { id: 'day11-s1', name: '飛來寺觀景台',     gps: [28.452, 98.882], hasImg: true, day: 11 },
        { id: 'day10-s3', name: '白馬雪山觀景台',   gps: [28.380, 99.080], hasImg: true, day: 10 },
        { id: 'day10-s4', name: '霧濃頂觀景台',     gps: [28.435, 98.917], hasImg: true, day: 10 },
        { id: 'day10-s1', name: '松贊林寺',         gps: [27.880, 99.715], hasImg: true, day: 10 },
        { id: 'day10-s2', name: '大經幡',           gps: [27.829, 99.706], hasImg: true, day: 10 },
        { id: 'day9-s2',  name: '獨克宗古城',       gps: [27.824, 99.707], hasImg: true, day: 9 },
        { id: 'day9-s1',  name: '虎跳峽',           gps: [27.198, 100.097], hasImg: true, day: 9 },
        { id: 'day11-s2', name: '金沙江第一灣',     gps: [28.005, 99.310], hasImg: true, day: 11 },
        { id: 'day12-s1', name: '普達措國家公園',   gps: [27.890, 99.962], hasImg: true, day: 12 },
        { id: 'day12-s2', name: '納帕海',           gps: [27.838, 99.629], hasImg: true, day: 12 },
      ],
    },
  },
  // Spot detail: image + intro + feature pointer (normalized x/y over the spot image)
  spots: {
    // ===== Existing v28 spot entries (14) =====
    'day2-s1': {
      name: '石林風景區', region: 'kunming',
      img: 'img/v28_spot_day2-s1_shilin.webp', aspect: 4/3,
      intro: '位於昆明東南 80 公里嘅雲南石林，係世界自然遺產同國家 5A 景區。 2.7 億年前嘅海洋沉積石灰岩經侵蝕後形成嘅喀斯特地貌，灰色石柱拔地而起、形態各異，被稱為「天下第一奇觀」。',
      pointers: [
        { x: 0.50, y: 0.38, label: '石柱拔地而起', note: '灰藍色喀斯特石柱，最高 30 米' },
        { x: 0.78, y: 0.72, label: '亭中觀景', note: '青瓦亭仔做尺度對比' },
      ],
    },
    'day4-s1': {
      name: '喜洲古鎮', region: 'dali',
      img: 'img/v28_spot_day4-s1_xizhou.webp', aspect: 4/3,
      intro: '大理北部嘅白族文化重鎮，明清古建群保存完整。白牆灰瓦嘅「三坊一照壁」、「四合五天井」庭院建築十分典型。喜洲粑粑（玫瑰豬肉餡烤餅）係必食小食。',
      pointers: [
        { x: 0.30, y: 0.50, label: '白族民居', note: '三坊一照壁式樣' },
        { x: 0.62, y: 0.70, label: '喜洲粑粑', note: '木製攤檔現做現賣' },
      ],
    },
    'day4-s4': {
      name: '崇聖寺三塔', region: 'dali',
      img: 'img/v28_spot_day4-s4_chongsheng.webp', aspect: 4/3,
      intro: '大理嘅地標性建築，南詔大理國時期皇家寺院。中央嘅千尋塔高 69 米共 16 級，兩側南北小塔各高 42 米共 10 級。塔影倒映喺前面嘅聚影池，背靠蒼山十九峰。',
      pointers: [
        { x: 0.50, y: 0.38, label: '千尋塔', note: '中央主塔 69m / 16 級' },
        { x: 0.50, y: 0.78, label: '聚影池倒影', note: '塔影與山色合一' },
      ],
    },
    'day4-s5': {
      name: '大理古城', region: 'dali',
      img: 'img/v28_spot_day4-s5_daligucheng.webp', aspect: 4/3,
      intro: '明洪武十五年（1382）建嘅古城，城牆呈方型、四面有門。城內五華樓、洋人街、人民路係主要遊覽軸線，背靠蒼山、面臨洱海。係感受白族生活同食大理小食最熱鬧嘅地方。',
      pointers: [
        { x: 0.32, y: 0.46, label: '城門樓', note: '紅木青瓦明代建築' },
        { x: 0.68, y: 0.30, label: '蒼山十九峰', note: '青藍水墨遠景' },
      ],
    },
    'day5-s2': {
      name: '寂照庵', region: 'lijiang',
      img: 'img/v28_spot_day5-s2_jizhao.webp', aspect: 4/3,
      intro: '位於蒼山聖應峰南麓、海拔 2,600 米嘅尼姑庵，建於明代。庵內外種滿多肉植物同四季鮮花，被譽為「最美尼姑庵」、「鮮花禪院」。素齋出名。',
      pointers: [
        { x: 0.45, y: 0.55, label: '青瓦禪院', note: '蒼山半山小庵' },
        { x: 0.40, y: 0.72, label: '多肉花園', note: '四季盛開' },
      ],
    },
    'day5-s3': {
      name: '麗江古城', region: 'lijiang',
      img: 'img/v28_spot_day5-s3_lijiang_old.webp', aspect: 4/3,
      intro: '世界文化遺產，800 年歷史嘅納西族古城，大研古鎮係核心區。青石板路、小橋流水、納西民居四合院、東巴文字招牌係特色。夜晚酒吧街熱鬧。',
      pointers: [
        { x: 0.50, y: 0.50, label: '納西民居', note: '灰瓦四合院密集' },
        { x: 0.30, y: 0.72, label: '小橋流水', note: '玉河水穿城而過' },
      ],
    },
    'day6-s1': {
      name: '玉龍雪山', region: 'lijiang',
      img: 'img/v28_spot_day6-s1_yulong.webp', aspect: 4/3,
      intro: '北半球最南嘅雪山，主峰扇子陡海拔 5,596 米、13 座雪峰連綿如玉龍。係納西族嘅神山，山上有冰川、草甸、原始森林。可坐索道上 4,506 米嘅冰川公園。',
      pointers: [
        { x: 0.45, y: 0.30, label: '扇子陡主峰', note: '5,596m 終年積雪' },
        { x: 0.40, y: 0.85, label: '徒步行人', note: '對比體會山之巨大' },
      ],
    },
    'day6-s3': {
      name: '藍月谷', region: 'lijiang',
      img: 'img/v28_spot_day6-s3_bluemoon.webp', aspect: 4/3,
      intro: '位於玉龍雪山東麓嘅高山谷地，雪山融水形成嘅 4 個梯級湖泊（玉液湖、鏡潭湖、藍月湖、聽濤湖）顏色由淡綠到湛藍，因水底有白色碳酸鈣沉積。',
      pointers: [
        { x: 0.50, y: 0.55, label: '玉液湖', note: '碳酸鈣形成嘅湛藍' },
        { x: 0.80, y: 0.30, label: '雪山源頭', note: '玉龍雪山冰川融水' },
      ],
    },
    'day7-s1': {
      name: '瀘沽湖觀景台', region: 'lugu',
      img: 'img/v28_spot_day7-s1_lugu_view.webp', aspect: 4/3,
      intro: '雲南—四川交界嘅高原湖泊，海拔 2,690 米，係中國最深嘅內陸湖之一。湖中有 5 個島，湖畔住緊摩梭族，至今保留「走婚」習俗。',
      pointers: [
        { x: 0.50, y: 0.45, label: '心形湖面', note: '高原湛藍倒影' },
        { x: 0.30, y: 0.65, label: '豬槽船', note: '摩梭人傳統獨木舟' },
      ],
    },
    'day9-s1': {
      name: '虎跳峽', region: 'shangrila',
      img: 'img/v28_spot_day9-s1_tigerleap.webp', aspect: 4/3,
      intro: '世界上最深嘅大峽谷之一，全長 17 公里，落差 3,790 米。金沙江喺玉龍雪山同哈巴雪山之間奔流而過，傳說有老虎一躍而過、故得名。上虎跳係最壯觀嘅景點。',
      pointers: [
        { x: 0.50, y: 0.62, label: '金沙江奔流', note: '白浪翻騰、聲若雷鳴' },
        { x: 0.50, y: 0.50, label: '虎跳石', note: '江中巨石、傳說中虎躍石' },
      ],
    },
    'day9-s2': {
      name: '獨克宗古城', region: 'shangrila',
      img: 'img/v28_spot_day9-s2_dukezong.webp', aspect: 4/3,
      intro: '香格里拉嘅老城區，藏語意為「月光城」、唐代吐蕃所建。藏式石木民居沿坡而上，山頂龜山公園有世界最大轉經筒，需 5 個人合力先轉到。',
      pointers: [
        { x: 0.55, y: 0.35, label: '大轉經筒', note: '世界最大、五彩經幡' },
        { x: 0.40, y: 0.70, label: '藏式石屋', note: '平頂、小窗、石木結構' },
      ],
    },
    'day10-s1': {
      name: '松贊林寺', region: 'shangrila',
      img: 'img/v28_spot_day10-s1_songzanlin.webp', aspect: 4/3,
      intro: '建於 1679 年嘅雲南最大藏傳佛教格魯派寺院，被譽為「小布達拉宮」。仿照拉薩布達拉宮樣式、依山而建，金頂、白牆、紅檐。寺前嘅拉姆央措湖倒映寺院。',
      pointers: [
        { x: 0.50, y: 0.45, label: '金頂主殿', note: '仿布達拉宮樣式' },
        { x: 0.50, y: 0.80, label: '拉姆央措湖', note: '寺前倒影池' },
      ],
    },
    'day11-s1': {
      name: '飛來寺梅里雪山', region: 'shangrila',
      img: 'img/v28_spot_day11-s1_meili.webp', aspect: 4/3,
      intro: '梅里雪山主峰卡瓦格博海拔 6,740 米，係藏地八大神山之首，至今未有人登頂成功。飛來寺觀景台係睇日照金山嘅最佳位置，清晨第一道陽光打喺雪山頂、金光燦爛。',
      pointers: [
        { x: 0.45, y: 0.20, label: '卡瓦格博主峰', note: '6,740m · 日照金山' },
        { x: 0.20, y: 0.60, label: '白塔觀景台', note: '飛來寺前嘅祈福塔' },
      ],
    },
    'day12-s1': {
      name: '普達措國家公園', region: 'shangrila',
      img: 'img/v28_spot_day12-s1_pudacuo.webp', aspect: 4/3,
      intro: '中國第一個國家公園，海拔 3,500–4,159 米。屬都湖、彌里塘亞高山牧場、碧塔海三大景區，原始杉木林、高原濕地、犛牛同杜鵑花海各俱風情。',
      pointers: [
        { x: 0.45, y: 0.55, label: '屬都湖', note: '高原鏡湖倒影' },
        { x: 0.70, y: 0.78, label: '木棧道', note: '環湖徒步路線' },
      ],
    },

    // ===== v29 new 19 spots =====
    'day1-s2': {
      name: '雙橋夜市', region: 'kunming',
      img: 'img/v29_spot_day1-s2_shuangqiao.webp', aspect: 4/3,
      intro: '昆明老城最熱鬧嘅夜市之一，紅燈籠串成街、小食檔由黃昏擺到深夜。豆花米線、過橋米線、燒餌塊、汽鍋雞，雲南風味一條街食晒。',
      pointers: [
        { x: 0.45, y: 0.55, label: '小食街檔', note: '雲南小食 + 街口炒粉' },
        { x: 0.30, y: 0.32, label: '紅燈籠長廊', note: '夜市標誌性入口' },
      ],
    },
    'day2-s2': {
      name: '撈魚河濕地', region: 'kunming',
      img: 'img/v29_spot_day2-s2_laoyu.webp', aspect: 4/3,
      intro: '滇池東岸嘅濕地公園，蘆葦同水杉沿湖鋪開，夕陽落入滇池嘅最佳位置之一。秋天枝葉變紅、湖面金光粼粼，係昆明本地人嘅週末打卡熱點。',
      pointers: [
        { x: 0.50, y: 0.50, label: '滇池日落', note: '黃昏金光落湖面' },
        { x: 0.25, y: 0.70, label: '木棧道', note: '沿濕地行入蘆葦深處' },
      ],
    },
    'day2-s3': {
      name: '昆明老街', region: 'kunming',
      img: 'img/v29_spot_day2-s3_kunmingoldstreet.webp', aspect: 4/3,
      intro: '正義路、文明街一帶嘅明清古建群，係昆明僅存嘅老城區。青磚黑瓦、石板路，馬家大院、傅氏宅院等歷史建築翻新後做茶館同雲菜館，夜晚紅燈籠別有韻味。',
      pointers: [
        { x: 0.45, y: 0.55, label: '青磚古巷', note: '明清商號街屋' },
        { x: 0.70, y: 0.30, label: '紅燈籠夜色', note: '老茶館門口' },
      ],
    },
    'day3-s2': {
      name: '理想邦', region: 'dali',
      img: 'img/v29_spot_day3-s2_lixiangbang.webp', aspect: 4/3,
      intro: '洱海東岸嘅希臘式白屋藍頂建築群，係近年大理最熱嘅打卡地之一。山坡上層層疊疊嘅幾何白屋望住洱海，鏡頭一打、彷彿到咗聖托里尼。',
      pointers: [
        { x: 0.45, y: 0.45, label: '白屋藍頂', note: '希臘式建築群' },
        { x: 0.70, y: 0.65, label: '洱海全景', note: '坡上望湖最開闊' },
      ],
    },
    'day3-s3': {
      name: '雙廊古鎮', region: 'dali',
      img: 'img/v29_spot_day3-s3_shuanglang.webp', aspect: 4/3,
      intro: '洱海北岸嘅白族古鎮，曾被楊麗萍家「太陽宮」帶旺成大理藝術家小鎮。臨海客棧、漁村青磚白牆、湖邊發呆椅，係慢遊洱海最舒服嘅一站。',
      pointers: [
        { x: 0.40, y: 0.50, label: '白族民居', note: '青磚灰瓦臨水而建' },
        { x: 0.70, y: 0.70, label: '湖邊發呆位', note: '漁船同石碼頭' },
      ],
    },
    'day3-s4': {
      name: '小普陀', region: 'dali',
      img: 'img/v29_spot_day3-s4_xiaoputuo.webp', aspect: 4/3,
      intro: '洱海中一座細小石灰岩島，島上建有觀音閣。海鷗繞島飛，遊船會停近島邊撒餌餵海鷗。傳說觀音曾係呢度顯靈、故得名「小普陀」。',
      pointers: [
        { x: 0.50, y: 0.45, label: '觀音閣', note: '島頂單層樓閣' },
        { x: 0.30, y: 0.65, label: '湖中孤島', note: '碧水中嘅石燈' },
      ],
    },
    'day4-s2': {
      name: '周城扎染', region: 'dali',
      img: 'img/v29_spot_day4-s2_zhoucheng.webp', aspect: 4/3,
      intro: '大理周城係白族扎染嘅發源地，「板藍根」植物染料浸出嘅靛藍布料係招牌。家家戶戶院子裏掛住扎好嘅藍布隨風飄，可現場體驗扎染、做條手帕帶走。',
      pointers: [
        { x: 0.40, y: 0.45, label: '靛藍布飄', note: '院子裏曬染布' },
        { x: 0.65, y: 0.65, label: '扎染工坊', note: '體驗手工紮花' },
      ],
    },
    'day4-s3': {
      name: '龍龕碼頭', region: 'dali',
      img: 'img/v29_spot_day4-s3_longkan.webp', aspect: 4/3,
      intro: '洱海環海路上嘅一個小漁村碼頭，木製漁船同石棧道伸入碧綠湖水，遠處蒼山十九峰一字排開。S 彎、玻璃球、心形樹係環海路最紅嘅打卡點。',
      pointers: [
        { x: 0.50, y: 0.55, label: 'S 彎碼頭', note: '木棧道伸入洱海' },
        { x: 0.75, y: 0.30, label: '蒼山遠景', note: '十九峰水墨剪影' },
      ],
    },
    'day5-s1': {
      name: '蒼山感通索道', region: 'lijiang',
      img: 'img/v29_spot_day5-s1_cangshan.webp', aspect: 4/3,
      intro: '蒼山十九峰之一，感通索道直上聖應峰，海拔 2,600 米睇大理壩子同洱海全景。沿索道升空、雲海貼住山腰，落山可步行去寂照庵。',
      pointers: [
        { x: 0.45, y: 0.40, label: '索道升空', note: '雲海貼山腰' },
        { x: 0.60, y: 0.70, label: '蒼山松林', note: '半山原始林帶' },
      ],
    },
    'day6-s2': {
      name: '雲杉坪', region: 'lijiang',
      img: 'img/v29_spot_day6-s2_yunshanping.webp', aspect: 4/3,
      intro: '玉龍雪山東麓嘅高山草甸，海拔 3,240 米，雲杉林環抱、草甸上常有犛牛同馬群。納西族傳說中「玉龍第三國」之地、係殉情者升仙嘅地方。',
      pointers: [
        { x: 0.45, y: 0.55, label: '高山草甸', note: '犛牛同馬在草地' },
        { x: 0.55, y: 0.25, label: '玉龍雪山', note: '草甸盡頭嘅雪峰' },
      ],
    },
    'day6-s4': {
      name: '白沙古鎮', region: 'lijiang',
      img: 'img/v29_spot_day6-s4_baisha.webp', aspect: 4/3,
      intro: '麗江最古老嘅納西族聚落，世界文化遺產嘅一部分。比大研古城更原始、商業氣息更淡，白沙壁畫係明代納西、漢、藏文化融合嘅佛教藝術代表。',
      pointers: [
        { x: 0.40, y: 0.50, label: '納西村心', note: '老石板路同壁畫牆' },
        { x: 0.70, y: 0.40, label: '青瓦民居', note: '木構騎樓街屋' },
      ],
    },
    'day7-s2': {
      name: '里格村', region: 'lugu',
      img: 'img/v29_spot_day7-s2_lige.webp', aspect: 4/3,
      intro: '瀘沽湖北岸嘅摩梭村落，位於三面環水嘅半島，係瀘沽湖最美村落之一。木屋臨水而建，岸邊泊住傳統豬槽船，黃昏湖光把半島染成金色。',
      pointers: [
        { x: 0.50, y: 0.55, label: '半島木屋群', note: '摩梭傳統民居' },
        { x: 0.30, y: 0.75, label: '岸邊豬槽船', note: '獨木舟靠岸' },
      ],
    },
    'day8-s1': {
      name: '豬槽船晨霧', region: 'lugu',
      img: 'img/v29_spot_day8-s1_zhugeboat.webp', aspect: 4/3,
      intro: '清晨四五點起身，乘摩梭族嘅獨木「豬槽船」入湖中心，喺乳白色晨霧裏等太陽由山脊升起。船槳劃破鏡面，係瀘沽湖最浪漫嘅一刻。',
      pointers: [
        { x: 0.40, y: 0.55, label: '晨霧獨木舟', note: '湖心一葉' },
        { x: 0.70, y: 0.35, label: '日出山脊', note: '金光劃破雲霧' },
      ],
    },
    'day8-s2': {
      name: '草海走婚橋', region: 'lugu',
      img: 'img/v29_spot_day8-s2_zoubun.webp', aspect: 4/3,
      intro: '瀘沽湖東南角嘅草海濕地，木製長橋穿過蘆葦同水草，係摩梭族傳統「走婚」習俗中男女相約嘅地方。秋天蘆葦轉黃，橋上行人剪影如畫。',
      pointers: [
        { x: 0.45, y: 0.60, label: '蘆葦木橋', note: '長橋穿草海' },
        { x: 0.70, y: 0.40, label: '草海濕地', note: '蘆葦同水草交織' },
      ],
    },
    'day10-s2': {
      name: '大經幡', region: 'shangrila',
      img: 'img/v29_spot_day10-s2_dajingfan.webp', aspect: 4/3,
      intro: '松贊林寺附近嘅大經幡陣，色彩鮮艷嘅五色經旗（藍白紅綠黃）由中心柱拉到四方，象徵風吹一次便念一次經文，藏地最具標誌性嘅祈福景觀之一。',
      pointers: [
        { x: 0.50, y: 0.45, label: '五色經幡', note: '藍白紅綠黃' },
        { x: 0.30, y: 0.70, label: '經幡柱基', note: '中心立柱' },
      ],
    },
    'day10-s3': {
      name: '白馬雪山觀景台', region: 'shangrila',
      img: 'img/v29_spot_day10-s3_baima.webp', aspect: 4/3,
      intro: '滇藏公路上海拔 4,292 米嘅啞口，係香格里拉去德欽必經之地。冬季積雪、夏季野花，觀景台前掛住長長嘅五色經幡，望住白馬雪山連綿主峰。',
      pointers: [
        { x: 0.45, y: 0.40, label: '4292m 啞口', note: '滇藏公路最高點' },
        { x: 0.30, y: 0.65, label: '五色經幡', note: '高原祈福風景' },
      ],
    },
    'day10-s4': {
      name: '霧濃頂觀景台', region: 'shangrila',
      img: 'img/v29_spot_day10-s4_wunongding.webp', aspect: 4/3,
      intro: '德欽縣前往飛來寺嘅必經觀景台，與梅里雪山隔江相望。十三座白塔由低至高排開，係翌朝睇梅里日照金山嘅「副舞台」、亦係黃昏雲海大本營。',
      pointers: [
        { x: 0.45, y: 0.50, label: '十三白塔', note: '排隊望雪山' },
        { x: 0.70, y: 0.30, label: '梅里遠景', note: '對岸雪山主峰' },
      ],
    },
    'day11-s2': {
      name: '金沙江第一灣', region: 'shangrila',
      img: 'img/v29_spot_day11-s2_jinshajiang.webp', aspect: 4/3,
      intro: '金沙江由青藏高原南下、喺德欽縣奔子欄拐出一個近 180 度嘅 U 字大彎，被稱為「萬里長江第一灣」。江水深綠、彎內三角洲農田層層疊疊。',
      pointers: [
        { x: 0.50, y: 0.50, label: 'U 字大彎', note: '180 度迴轉' },
        { x: 0.30, y: 0.70, label: '彎內梯田', note: '三角洲農田' },
      ],
    },
    'day12-s2': {
      name: '納帕海', region: 'shangrila',
      img: 'img/v29_spot_day12-s2_napahai.webp', aspect: 4/3,
      intro: '香格里拉壩子嘅高原季節性湖泊，秋冬季水位下降、變成大片濕地草甸，係黑頸鶴越冬地。犛牛同藏馬遍布草原，遠處依拉草原一路鋪到山腳。',
      pointers: [
        { x: 0.45, y: 0.55, label: '高原草甸', note: '犛牛同馬群' },
        { x: 0.70, y: 0.30, label: '遠山雪線', note: '草原盡頭嘅雪峰' },
      ],
    },
  },
};
