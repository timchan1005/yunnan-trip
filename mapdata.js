// Hand-drawn map data: 3-level drill-down hierarchy
// Level 0: Yunnan overview (5 region pins)
// Level 1: City region (spot pins inside region)
// Level 2: Spot detail (image + intro + feature pointer)
//
// All pin coords are normalized 0-1 (origin top-left) over their parent map image.

window.MAP_DATA = {
  overview: {
    img: 'img/v28_overview.webp',
    aspect: 3/4,
    regions: [
      // Position approximate based on Yunnan provincial shape in v28_overview.webp
      { id: 'kunming',   name: '昆明',        x: 0.58, y: 0.78, color: '#a8553d' },
      { id: 'dali',      name: '大理',        x: 0.34, y: 0.62, color: '#b67a3a' },
      { id: 'lijiang',   name: '麗江',        x: 0.40, y: 0.46, color: '#5d8c70' },
      { id: 'lugu',      name: '瀘沽湖',      x: 0.58, y: 0.40, color: '#496c8c' },
      { id: 'shangrila', name: '香格里拉',     x: 0.42, y: 0.22, color: '#3d5275' },
    ],
  },
  regions: {
    kunming: {
      name: '昆明',
      subtitle: '滇池畔嘅春城',
      img: 'img/v28_city_kunming.webp',
      aspect: 3/4,
      spots: [
        { id: 'day2-s1', name: '石林風景區',   x: 0.74, y: 0.52, hasImg: true, day: 2 },
        { id: 'day2-s2', name: '撈魚河濕地',   x: 0.32, y: 0.64, hasImg: false, day: 2 },
        { id: 'day2-s3', name: '昆明老街',     x: 0.45, y: 0.78, hasImg: false, day: 2 },
        { id: 'day1-s2', name: '雙橋夜市',     x: 0.38, y: 0.86, hasImg: false, day: 1 },
      ],
    },
    dali: {
      name: '大理',
      subtitle: '蒼山洱海 · 風花雪月',
      img: 'img/v28_city_dali.webp',
      aspect: 3/4,
      spots: [
        { id: 'day4-s1', name: '喜洲古鎮',     x: 0.62, y: 0.16, hasImg: true, day: 4 },
        { id: 'day3-s3', name: '雙廊古鎮',     x: 0.68, y: 0.10, hasImg: false, day: 3 },
        { id: 'day3-s4', name: '小普陀',       x: 0.56, y: 0.30, hasImg: false, day: 3 },
        { id: 'day4-s3', name: '龍龕碼頭',     x: 0.52, y: 0.46, hasImg: false, day: 4 },
        { id: 'day4-s4', name: '崇聖寺三塔',   x: 0.48, y: 0.92, hasImg: true, day: 4 },
        { id: 'day4-s5', name: '大理古城',     x: 0.42, y: 0.78, hasImg: true, day: 4 },
        { id: 'day3-s2', name: '理想邦',       x: 0.62, y: 0.62, hasImg: false, day: 3 },
        { id: 'day4-s2', name: '周城扎染',     x: 0.66, y: 0.22, hasImg: false, day: 4 },
      ],
    },
    lijiang: {
      name: '麗江',
      subtitle: '玉龍雪山 · 古城水鄉',
      img: 'img/v28_city_lijiang.webp',
      aspect: 3/4,
      spots: [
        { id: 'day6-s1', name: '玉龍雪山',     x: 0.50, y: 0.16, hasImg: true, day: 6 },
        { id: 'day6-s2', name: '雲杉坪',       x: 0.46, y: 0.26, hasImg: false, day: 6 },
        { id: 'day6-s3', name: '藍月谷',       x: 0.52, y: 0.36, hasImg: true, day: 6 },
        { id: 'day6-s4', name: '白沙古鎮',     x: 0.42, y: 0.48, hasImg: false, day: 6 },
        { id: 'day5-s1', name: '蒼山感通索道', x: 0.28, y: 0.56, hasImg: false, day: 5 },
        { id: 'day5-s2', name: '寂照庵',       x: 0.24, y: 0.64, hasImg: true, day: 5 },
        { id: 'day5-s3', name: '麗江古城',     x: 0.52, y: 0.62, hasImg: true, day: 5 },
      ],
    },
    lugu: {
      name: '瀘沽湖',
      subtitle: '摩梭家園 · 走婚橋',
      img: 'img/v28_city_lugu.webp',
      aspect: 3/4,
      spots: [
        { id: 'day7-s1', name: '瀘沽湖觀景台', x: 0.30, y: 0.36, hasImg: true, day: 7 },
        { id: 'day7-s2', name: '里格村',       x: 0.46, y: 0.24, hasImg: false, day: 7 },
        { id: 'day8-s1', name: '豬槽船晨霧',   x: 0.50, y: 0.50, hasImg: false, day: 8 },
        { id: 'day8-s2', name: '草海走婚橋',   x: 0.68, y: 0.60, hasImg: false, day: 8 },
      ],
    },
    shangrila: {
      name: '香格里拉',
      subtitle: '梅里日照金山 · 藏地秘境',
      img: 'img/v28_city_shangrila.webp',
      aspect: 3/4,
      spots: [
        { id: 'day11-s1', name: '飛來寺觀景台',     x: 0.30, y: 0.16, hasImg: true, day: 11 },
        { id: 'day10-s3', name: '白馬雪山觀景台',   x: 0.40, y: 0.28, hasImg: false, day: 10 },
        { id: 'day10-s4', name: '霧濃頂觀景台',     x: 0.34, y: 0.22, hasImg: false, day: 10 },
        { id: 'day10-s1', name: '松贊林寺',         x: 0.52, y: 0.52, hasImg: true, day: 10 },
        { id: 'day10-s2', name: '大經幡',           x: 0.56, y: 0.60, hasImg: false, day: 10 },
        { id: 'day9-s2',  name: '獨克宗古城',       x: 0.60, y: 0.62, hasImg: true, day: 9 },
        { id: 'day9-s1',  name: '虎跳峽',           x: 0.66, y: 0.78, hasImg: true, day: 9 },
        { id: 'day11-s2', name: '金沙江第一灣',     x: 0.48, y: 0.74, hasImg: false, day: 11 },
        { id: 'day12-s1', name: '普達措國家公園',   x: 0.66, y: 0.48, hasImg: true, day: 12 },
        { id: 'day12-s2', name: '納帕海',           x: 0.58, y: 0.42, hasImg: false, day: 12 },
      ],
    },
  },
  // Spot detail: image + intro + feature pointer (normalized x/y over the spot image)
  // "pointers" describe where to point on the image to highlight features
  spots: {
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
  },
};
