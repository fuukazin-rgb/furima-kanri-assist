(async () => {
  // ============================================================
  // 共通 rakuma_fill.js  （フリマ出品アシスト Pro / フリマ管理アシスト 共用）
  // ラクマ新フォーム(Chakra UI / Next.js) 対応版
  //  - name属性セレクタ (itemName / sellPrice / detail) を最優先
  //  - placeholder 独自記法 @ph: / @phTag: / @phTitle: を追加
  //  - 画像取得を background.js 経由(FETCH_IMAGE_BINARY)に変更
  //  - ブランド辞書 + fillBrand() 強化版を移植
  //  - rakumaFillResult を保存（管理アシストの実行結果パネル用。Proでは未使用だが無害）
//  - categoryPath / category どちらの項目名にも対応
  // ============================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CONDITION_MAP = {
    "新品、未使用": ["新品、未使用", "新品未使用"],
    "未使用に近い": ["未使用に近い"],
    "目立った傷や汚れなし": ["目立った傷や汚れなし"],
    "やや傷や汚れあり": ["やや傷や汚れあり"],
    "傷や汚れあり": ["傷や汚れあり"],
    "全体的に状態が悪い": ["全体的に状態が悪い"]
  };

  // ノイズワード（ブランドではない頻出単語）
  const NOISE_WORDS = new Set([
    // 状態
    "美品", "新品", "中古", "未使用", "極美品", "良品", "希少", "レア", "限定",
    "国内正規品", "正規品", "本物", "本物保証", "純正", "ジャンク", "訳あり",
    "送料無料", "送料込み", "匿名配送", "即購入OK", "即購入可", "値下げ",
    "セール", "SALE", "在庫処分", "新作", "未開封", "新品未使用", "未使用品",
    "タグ付き", "タグ付", "箱付き", "保証書付", "付属品完備", "完品",
    // 性別/サイズ
    "メンズ", "レディース", "キッズ", "ベビー", "ユニセックス",
    "サイズ", "SIZE", "Size",
    "S", "M", "L", "F", "XL", "XXL", "FREE", "ONESIZE",
    // 色
    "ホワイト", "ブラック", "ブルー", "レッド", "グリーン", "イエロー",
    "ピンク", "グレー", "ネイビー", "ベージュ", "ブラウン", "シルバー", "ゴールド",
    "White", "Black", "Blue", "Red", "Green", "Yellow", "Pink", "Gray", "Grey",
    "Navy", "Beige", "Brown", "Silver", "Gold",
    "WHITE", "BLACK", "BLUE", "RED",
    // 一般語（モデル名修飾）
    "Pro", "PRO", "Mini", "MINI", "Air", "AIR", "Plus", "PLUS", "Max", "MAX",
    "Ultra", "ULTRA", "Lite", "LITE", "Standard", "STD",
    "Mark", "MARK", "Series", "SERIES", "Edition", "EDITION", "Model", "MODEL", "モデル",
    "Limited", "LIMITED", "Special", "SPECIAL",
    "New", "NEW", "Old", "OLD", "Used",
    "Set", "SET", "セット", "Kit", "KIT", "キット",
    // 単位
    "GB", "TB", "MB", "KB", "MP", "MHz", "GHz", "mm", "cm", "kg", "g", "ml",
    "インチ", "inch", "INCH",
    // 通信
    "SIM", "sim", "eSIM", "WiFi", "Wi-Fi", "5G", "4G", "LTE", "GPS",
    // 商品種別（一般名詞）
    "スマートフォン", "スマホ", "タブレット", "ノートパソコン", "パソコン",
    "カメラ", "レンズ", "ヘッドホン", "イヤホン", "スピーカー",
    "マウンテンパーカー", "ジャケット", "コート", "シャツ", "パンツ", "デニム",
    "リネンシャツ", "バックパック", "リュック", "ショルダーバッグ", "トートバッグ",
    "スマートフォンジンバル", "ジンバル", "アクションカメラ", "ヘッドフォン",
    "ピアス", "ネックレス", "ブレスレット", "リング", "イヤリング",
    "腕時計", "時計", "ウォッチ",
    "デイトナ", "ナチュラルチタニウム", "ココマーク",
    "ディスクドライブ", "ドライブ", "本体", "ハンディ", "コンパクト",
    "トレーディングカード", "トレカ", "カード",
    // モデル名・型番
    "Switch", "EOS", "HERO", "Phone", "Watch", "Galaxy",
    "QuietComfort", "Headphones",
    "OM4", "OM5", "OM6", "OM7", "R6", "R5", "R3", "R7", "R8",
    "ボディ", "ストア", "アプリ", "保証", "対応", "用",
    // 短すぎる/紛らわしい英字
    "On", "OM", "EL", "LN", "II", "III", "IV", "VI", "VII", "VIII", "IX",
    "HEAD", "AT", "OS", "PC", "TV", "AV", "DJ", "MC", "AI"
  ]);

  // シリーズ/作品名 → 実ブランド マッピング辞書
  const SERIES_TO_BRAND = {
    // Apple製品ライン → Apple（製品名からブランドを特定）
    "iMac": "Apple",
    "iMac Pro": "Apple",
    "MacBook": "Apple",
    "MacBook Pro": "Apple",
    "MacBook Air": "Apple",
    "Mac mini": "Apple",
    "Mac Studio": "Apple",
    "Mac Pro": "Apple",
    "Magic Keyboard": "Apple",
    "Magic Mouse": "Apple",
    "Magic Trackpad": "Apple",
    "Apple Pencil": "Apple",
    "AirTag": "Apple",
    "Apple TV": "Apple",
    "HomePod": "Apple",
    "Vision Pro": "Apple",
    "Thunderbolt Display": "Apple",
    "Studio Display": "Apple",
    // アニメ・ゲーム・キャラクター系
    "ドラゴンボール": "BANDAI",
    "ドラゴンボールヒーローズ": "BANDAI",
    "ドラゴンボールZ": "BANDAI",
    "ドラゴンボールGT": "BANDAI",
    "ドラゴンボール超": "BANDAI",
    "ワンピース": "BANDAI",
    "ONE PIECE": "BANDAI",
    "ガンダム": "BANDAI",
    "ガンプラ": "BANDAI",
    "プリキュア": "BANDAI",
    "戦隊": "BANDAI",
    "ライダー": "BANDAI",
    "仮面ライダー": "BANDAI",
    "ウルトラマン": "BANDAI",
    "たまごっち": "BANDAI",
    "ジョジョ": "BANDAI",
    "鬼滅の刃": "BANDAI",
    "呪術廻戦": "BANDAI",
    "デジモン": "BANDAI",
    "聖闘士星矢": "BANDAI",
    "セーラームーン": "BANDAI",
    "プリパラ": "BANDAI",
    "アイカツ": "BANDAI",
    "妖怪ウォッチ": "BANDAI",
    "ベルト": "BANDAI",
    "DXフィギュア": "BANDAI",
    "S.H.Figuarts": "BANDAI",
    "フィギュアーツ": "BANDAI",
    "メタルビルド": "BANDAI",
    "プラレール": "タカラトミー",
    "トミカ": "タカラトミー",
    "ベイブレード": "タカラトミー",
    "リカちゃん": "タカラトミー",
    "デュエルマスターズ": "タカラトミー",
    "デュエマ": "タカラトミー",
    "アニア": "タカラトミー",
    "ZOIDS": "タカラトミー",
    "ゾイド": "タカラトミー",
    "トランスフォーマー": "タカラトミー",
    "人生ゲーム": "タカラトミー",
    "黒ひげ危機一発": "タカラトミー",
    "ジェンガ": "タカラトミー",
    "ポケモン": "ポケモン",
    "ポケットモンスター": "ポケモン",
    "ポケモンカード": "ポケモン",
    "ポケカ": "ポケモン",
    "ピカチュウ": "ポケモン",
    "マリオ": "任天堂",
    "スーパーマリオ": "任天堂",
    "ゼルダ": "任天堂",
    "スプラトゥーン": "任天堂",
    "あつまれどうぶつの森": "任天堂",
    "あつ森": "任天堂",
    "カービィ": "任天堂",
    "スマブラ": "任天堂",
    "ピクミン": "任天堂",
    "メトロイド": "任天堂",
    "遊戯王": "コナミ",
    "ボンバーマン": "コナミ",
    "ウイニングイレブン": "コナミ",
    "実況パワフル": "コナミ",
    "メタルギア": "コナミ",
    "ソニック": "セガ",
    "ぷよぷよ": "セガ",
    "龍が如く": "セガ",
    "サクラ大戦": "セガ",
    "アンパンマン": "セガトイズ",
    "シルバニアファミリー": "エポック社",
    "野球盤": "エポック社",
    "サッカー盤": "エポック社",
    "ミッキー": "Disney",
    "ミニー": "Disney",
    "ディズニープリンセス": "Disney",
    "アナと雪の女王": "Disney",
    "ディズニー": "Disney",
    "スターウォーズ": "Disney",
    "STAR WARS": "Disney",
    "マーベル": "Disney",
    "MARVEL": "Disney",
    "アベンジャーズ": "Disney",
    "ピクサー": "Disney",
    "PIXAR": "Disney",
    "トイストーリー": "Disney",
    "プーさん": "Disney",
    "リトルマーメイド": "Disney",
    "ハローキティ": "サンリオ",
    "Hello Kitty": "サンリオ",
    "シナモロール": "サンリオ",
    "マイメロディ": "サンリオ",
    "クロミ": "サンリオ",
    "ポムポムプリン": "サンリオ",
    "けろけろけろっぴ": "サンリオ",
    "ぐでたま": "サンリオ",
    "アイドルマスター": "バンダイナムコ",
    "アイマス": "バンダイナムコ",
    "テイルズ": "バンダイナムコ",
    "ファイナルファンタジー": "スクウェア・エニックス",
    "FF": "スクウェア・エニックス",
    "ドラゴンクエスト": "スクウェア・エニックス",
    "ドラクエ": "スクウェア・エニックス",
    "キングダムハーツ": "スクウェア・エニックス",
    "ニーア": "スクウェア・エニックス",
    "モンスターハンター": "カプコン",
    "モンハン": "カプコン",
    "ストリートファイター": "カプコン",
    "バイオハザード": "カプコン",
    "ロックマン": "カプコン",
    "となりのトトロ": "スタジオジブリ",
    "千と千尋": "スタジオジブリ",
    "もののけ姫": "スタジオジブリ",
    "魔女の宅急便": "スタジオジブリ",
    "ジブリ": "スタジオジブリ",
    "ドラえもん": "小学館",
    "クレヨンしんちゃん": "双葉社",
    "ちいかわ": "ちいかわ",
    "すみっコぐらし": "サンエックス",
    "リラックマ": "サンエックス",
    "コリラックマ": "サンエックス",
    "ミッフィー": "Miffy",
    "スヌーピー": "PEANUTS",
    "Snoopy": "PEANUTS"
  };

  // ブランド辞書
  const BRAND_KEYWORDS = [
    // === カメラ本体・レンズ ===
    "キヤノン", "Canon", "ニコン", "Nikon",
    "ソニー", "SONY", "富士フイルム", "FUJIFILM", "FUJI",
    "オリンパス", "OLYMPUS", "OM SYSTEM", "OMシステム",
    "パナソニック", "Panasonic", "LUMIX", "ルミックス",
    "RICOH", "リコー", "PENTAX", "ペンタックス",
    "Leica", "ライカ", "Hasselblad", "ハッセルブラッド",
    "シグマ", "SIGMA", "タムロン", "TAMRON",
    "ツァイス", "ZEISS", "Carl Zeiss",
    "コダック", "KODAK", "ポラロイド", "Polaroid",
    "Mamiya", "マミヤ", "Bronica", "ブロニカ",
    "Manfrotto", "マンフロット", "GITZO", "ジッツオ",
    "VELBON", "ベルボン", "SLIK", "スリック",
    "Lowepro", "ロープロ", "Peak Design", "ピークデザイン",
    // === 映像機器・ジンバル・アクションカメラ ===
    "DJI", "ディージェイアイ", "OSMO", "Osmo", "Mavic", "RONIN", "Pocket",
    "GoPro", "ゴープロ",
    "Insta360", "インスタ360",
    "Zhiyun", "ジーウン", "Feiyu", "Feiyutech", "フェイユー",
    "BlackMagic", "ブラックマジック", "BlackMagicDesign",
    "ARRI", "アリ",
    "Atomos", "アトモス", "SmallRig", "スモールリグ",
    "Aputure", "アプチャー", "Godox", "ゴドックス",
    "Profoto", "プロフォト", "Elinchrom", "エリンクローム",
    "Rode", "ロード", "TASCAM", "タスカム",
    "DJI Mic", "Hollyland",
    // === スマホ・タブレット ===
    "Apple", "アップル", "iPhone", "アイフォン", "iPad", "アイパッド",
    "Samsung", "サムスン", "ギャラクシー",
    "Xperia", "エクスペリア", "AQUOS", "アクオス",
    "Pixel", "ピクセル", "Google Pixel",
    "Huawei", "ファーウェイ", "Xiaomi", "シャオミ",
    "OPPO", "オッポ", "OnePlus", "ワンプラス",
    "Nothing", "ナッシング", "Motorola", "モトローラ",
    "Realme", "リアルミー", "Vivo", "ビボ",
    "Kindle", "キンドル", "Fire HD",
    // === PC・周辺機器 ===
    "Microsoft", "マイクロソフト", "Surface", "サーフェス",
    "Lenovo", "レノボ", "ThinkPad", "シンクパッド",
    "Dell", "HP", "ヒューレットパッカード",
    "ASUS", "エイスース", "Acer", "エイサー", "MSI", "エムエスアイ",
    "富士通", "FUJITSU", "NEC", "東芝", "TOSHIBA", "Dynabook",
    "Razer", "レイザー", "ROG", "Alienware", "エイリアンウェア",
    "Logicool", "ロジクール", "Logitech", "ロジテック",
    "Anker", "アンカー", "Belkin", "ベルキン",
    "BUFFALO", "バッファロー", "I-O DATA", "アイオーデータ", "ELECOM", "エレコム",
    "Corsair", "コルセア",
    "Intel", "インテル", "AMD", "Ryzen", "Core i",
    "NVIDIA", "GeForce", "Radeon",
    "Western Digital", "Seagate", "シーゲート",
    "Crucial", "クルーシャル", "Kingston", "キングストン", "SanDisk", "サンディスク",
    "SteelSeries", "スティールシリーズ", "HyperX",
    // === オーディオ ===
    "BOSE", "ボーズ", "JBL", "ヤマハ", "YAMAHA",
    "Pioneer", "パイオニア", "DENON", "デノン", "Marantz", "マランツ",
    "Bang & Olufsen", "B&O", "バングアンドオルフセン",
    "Sennheiser", "ゼンハイザー", "AKG",
    "audio-technica", "オーディオテクニカ",
    "SHURE", "シュア", "Beyerdynamic", "ベイヤーダイナミック",
    "Beats", "ビーツ", "AirPods", "エアポッズ",
    "Shokz", "ショックス", "Jabra", "ジャブラ",
    "FOSTEX", "フォステクス", "ONKYO", "オンキヨー",
    "TEAC", "ティアック", "ULTRASONE",
    "Soundpeats", "サウンドピーツ", "EarFun", "イヤーファン",
    "FINAL", "ファイナル",
    // === ゲーム機・玩具メーカー ===
    "任天堂", "Nintendo", "ニンテンドー", "Nintendo Switch",
    "PlayStation", "プレイステーション", "PS5", "PS4", "プレステ",
    "Xbox", "エックスボックス",
    "Steam Deck", "スチームデック",
    "ROG Ally", "Meta Quest", "Oculus", "オキュラス",
    "BANDAI", "バンダイ", "バンダイナムコ",
    "タカラトミー", "TAKARA TOMY", "Takara Tomy",
    "セガ", "SEGA", "セガトイズ",
    "コナミ", "KONAMI", "Konami",
    "カプコン", "CAPCOM", "Capcom",
    "スクウェア・エニックス", "スクエニ", "Square Enix", "SQUARE ENIX",
    "エポック社", "EPOCH",
    "ポケモン", "Pokemon", "Pokémon",
    "サンリオ", "Sanrio",
    "Disney", "ディズニー",
    "MARVEL", "マーベル",
    "PEANUTS", "Peanuts",
    "Miffy", "ミッフィー",
    "サンエックス", "San-X",
    "ちいかわ",
    // === バッグ・カバン ===
    "ポーター", "PORTER", "吉田カバン", "ヨシダカバン",
    "ルイヴィトン", "ルイ・ヴィトン", "LOUIS VUITTON", "ヴィトン",
    "シャネル", "CHANEL", "エルメス", "HERMES",
    "グッチ", "GUCCI", "プラダ", "PRADA", "コーチ", "COACH",
    "ケイトスペード", "kate spade", "マイケルコース", "MICHAEL KORS",
    "サマンサタバサ", "Samantha Thavasa", "アネロ", "anello",
    "マンハッタンポーテージ", "Manhattan Portage",
    "BRIEFING", "ブリーフィング", "TUMI", "トゥミ",
    "RIMOWA", "リモワ", "Samsonite", "サムソナイト",
    "Ace", "エース", "プロテカ", "PROTECA",
    // === アウトドア・登山 ===
    "ノースフェイス", "THE NORTH FACE", "ノースフェース",
    "グレゴリー", "GREGORY", "アークテリクス", "ARC'TERYX", "Arc'teryx",
    "パタゴニア", "patagonia", "コロンビア", "Columbia",
    "ミステリーランチ", "MYSTERY RANCH", "オスプレー", "OSPREY",
    "カリマー", "karrimor", "ミレー", "MILLET",
    "モンベル", "mont-bell", "Montbell",
    "MAMMUT", "マムート",
    "Salomon", "サロモン", "MERRELL", "メレル",
    "Black Diamond", "ブラックダイヤモンド",
    "Coleman", "コールマン", "Snow Peak", "スノーピーク",
    "Logos", "ロゴス", "Captain Stag", "キャプテンスタッグ",
    "DOD", "ディーオーディー",
    // === アパレル ===
    "ユニクロ", "UNIQLO", "GU", "ジーユー",
    "ZARA", "ザラ", "H&M", "GAP", "ギャップ",
    "無印良品", "MUJI",
    "ビームス", "BEAMS", "ユナイテッドアローズ", "UNITED ARROWS",
    "シップス", "SHIPS", "アーバンリサーチ", "URBAN RESEARCH",
    "ジャーナルスタンダード", "JOURNAL STANDARD",
    "ナノユニバース", "nano universe",
    "ビューティアンドユース", "BEAUTY&YOUTH",
    "ベイクルーズ", "BAYCREW'S",
    "ローリーズファーム", "LOWRYS FARM",
    // === スポーツ・スニーカー ===
    "ナイキ", "NIKE", "アディダス", "adidas", "プーマ", "PUMA",
    "ニューバランス", "New Balance", "コンバース", "CONVERSE",
    "バンズ", "VANS", "リーボック", "Reebok",
    "アンダーアーマー", "UNDER ARMOUR",
    "アシックス", "ASICS", "ミズノ", "MIZUNO",
    "デサント", "DESCENTE",
    "ホカ", "HOKA", "HOKA ONE ONE",
    "Ralph Lauren", "ラルフローレン", "POLO RALPH",
    "トミーヒルフィガー", "TOMMY HILFIGER",
    "Lacoste", "ラコステ", "Fred Perry", "フレッドペリー",
    // === スポーツ用品 ===
    "ZETT", "ゼット", "SSK", "エスエスケー",
    "Wilson", "ウィルソン", "Rawlings", "ローリングス",
    "ルイスビル", "Louisville Slugger",
    "Dunlop", "ダンロップ", "BABOLAT", "バボラ",
    "Yonex", "ヨネックス", "PRINCE", "プリンス",
    "HEAD ヘッド",
    "Titleist", "タイトリスト", "PING", "ピン",
    "TaylorMade", "テーラーメイド", "Callaway", "キャロウェイ",
    "Bridgestone Golf", "ブリヂストンゴルフ", "SRIXON", "スリクソン",
    "ホンマ", "HONMA",
    "molten", "モルテン", "MIKASA", "ミカサ",
    "Spalding", "スポルディング",
    // === 自転車・バイク ===
    "ブリヂストン", "BRIDGESTONE", "シマノ", "SHIMANO",
    "GIANT", "ジャイアント", "TREK", "トレック", "Specialized", "スペシャライズド",
    "Cannondale", "キャノンデール", "BIANCHI", "ビアンキ",
    "Pinarello", "ピナレロ", "Colnago", "コルナゴ",
    "Honda", "ホンダ", "ヤマハ発動機", "Yamaha Motor",
    "カワサキ", "Kawasaki", "スズキ", "SUZUKI",
    "Harley-Davidson", "ハーレーダビッドソン",
    "Ducati", "ドゥカティ", "BMW Motorrad",
    "SHOEI", "ショウエイ", "Arai", "アライ",
    "OGK Kabuto", "OGKカブト",
    // === 高級ブランド ===
    "バーバリー", "BURBERRY", "ディオール", "Dior",
    "サンローラン", "Saint Laurent", "ボッテガヴェネタ", "BOTTEGA VENETA",
    "セリーヌ", "CELINE", "フェンディ", "FENDI",
    "バレンシアガ", "BALENCIAGA", "ヴァレンティノ", "VALENTINO",
    "アルマーニ", "ARMANI", "ヴェルサーチ", "VERSACE",
    "クロエ", "Chloe", "ミュウミュウ", "MIU MIU",
    "ジバンシィ", "GIVENCHY", "Dolce & Gabbana", "ドルチェ&ガッバーナ",
    "MaxMara", "マックスマーラ", "Moncler", "モンクレール",
    "イヴサンローラン", "YSL", "TOM FORD", "トムフォード",
    // === 時計 ===
    "オメガ", "OMEGA", "ロレックス", "ROLEX",
    "カルティエ", "Cartier", "ティファニー", "TIFFANY",
    "セイコー", "SEIKO", "シチズン", "CITIZEN", "カシオ", "CASIO",
    "G-SHOCK", "Gショック", "BABY-G", "PROTREK",
    "OCEANUS", "オシアナス", "EDIFICE", "エディフィス",
    "タグホイヤー", "TAG HEUER", "ブライトリング", "BREITLING",
    "IWC", "ウブロ", "HUBLOT", "パネライ", "PANERAI",
    "ブルガリ", "BVLGARI",
    "パテックフィリップ", "Patek Philippe",
    "オーデマピゲ", "Audemars Piguet",
    "フランクミュラー", "FRANCK MULLER",
    "Apple Watch", "アップルウォッチ",
    "Garmin", "ガーミン", "Fitbit", "フィットビット",
    // === ストリート ===
    "シュプリーム", "SUPREME", "ステューシー", "STUSSY",
    "アベイシングエイプ", "BAPE", "ア ベイシング エイプ",
    "オフホワイト", "OFF-WHITE", "フィアオブゴッド", "FEAR OF GOD",
    "Palace", "パレス", "Kith", "キス",
    "Champion", "チャンピオン", "Carhartt", "カーハート",
    "Dickies", "ディッキーズ",
    // === 家電 ===
    "シャープ", "SHARP", "三菱電機", "Mitsubishi", "ダイキン", "DAIKIN",
    "象印", "ZOJIRUSHI", "タイガー", "TIGER",
    "アイリスオーヤマ", "IRIS OHYAMA",
    "Dyson", "ダイソン", "Roomba", "ルンバ", "iRobot",
    "Tineco", "ティネコ", "Shark", "シャーク",
    "ティファール", "T-fal", "DeLonghi", "デロンギ",
    "KitchenAid", "キッチンエイド", "Vitamix", "バイタミックス",
    "ネスプレッソ", "Nespresso", "ネスカフェ", "Nescafe",
    "バルミューダ", "BALMUDA",
    "ブラウン", "BRAUN", "Philips", "フィリップス",
    "シロカ", "siroca", "山善", "YAMAZEN",
    // === 美容・コスメ ===
    "資生堂", "SHISEIDO", "コーセー", "KOSE",
    "シュウウエムラ", "shu uemura", "イプサ", "IPSA",
    "SK-II", "MAC", "ナーズ", "NARS", "ボビイブラウン", "BOBBI BROWN",
    "ランコム", "LANCOME", "クリニーク", "CLINIQUE",
    "エスティローダー", "Estee Lauder",
    "DECORTÉ", "コスメデコルテ",
    "ALBION", "アルビオン", "POLA", "ポーラ",
    "クレドポー", "Cle de Peau",
    "アディクション", "ADDICTION",
    "セルヴォーク", "Celvoke",
    "RMK", "アールエムケー",
    "Three", "スリー", "SUQQU", "スック",
    // === 楽器 ===
    "Roland", "ローランド",
    "Korg", "コルグ", "KAWAI", "カワイ",
    "Fender", "フェンダー", "Gibson", "ギブソン",
    "Ibanez", "アイバニーズ", "Martin", "マーチン",
    "Taylor", "テイラー", "Paul Reed Smith",
    "ESP", "Schecter", "シェクター",
    "BOSS", "ボス", "Line 6", "ライン6",
    // === ベビー・キッズ ===
    "アップリカ", "Aprica", "コンビ", "Combi",
    "Pigeon", "ピジョン", "BABYBJORN", "ベビービョルン",
    "STOKKE", "ストッケ",
  ];

  // ------------------------------------------------------------
  // 汎用ユーティリティ
  // ------------------------------------------------------------
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ラクマ新フォーム(Chakra UI)対応:
  //  通常のCSSセレクタに加え、独自記法 "@ph:" "@phTag:" "@phTitle:" をサポート。
  //  Chakraでは同一クラスが全入力欄で共有されるため、placeholder で見分ける必要がある。
  function qsPlaceholder(keyword, tag = "input,textarea", root = document, excludes = []) {
    const els = [...root.querySelectorAll(tag)].filter((el) => {
      if (!isVisible(el)) return false;
      const ph = el.getAttribute("placeholder") || "";
      if (!ph.includes(keyword)) return false;
      if (excludes.some((ex) => ph.includes(ex))) return false;
      return true;
    });
    return els[0] || null;
  }

  function qs(selectors, root = document) {
    for (const sel of selectors) {
      if (typeof sel === "string" && sel.startsWith("@phTitle:")) {
        const keyword = sel.slice(9);
        const el = qsPlaceholder(keyword, "input,textarea", root,
          ["¥", "価格", "9,999", "探す", "キーワード", "郵便番号", "電話"]);
        if (el) return el;
        continue;
      }
      if (typeof sel === "string" && sel.startsWith("@phTag:")) {
        const rest = sel.slice(7);
        const idx = rest.indexOf(":");
        if (idx > 0) {
          const tag = rest.slice(0, idx);
          const keyword = rest.slice(idx + 1);
          const el = qsPlaceholder(keyword, tag, root);
          if (el) return el;
        }
        continue;
      }
      if (typeof sel === "string" && sel.startsWith("@ph:")) {
        const keyword = sel.slice(4);
        const el = qsPlaceholder(keyword, "input,textarea", root);
        if (el) return el;
        continue;
      }
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  async function waitForElement(selectors, timeout = 15000, interval = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = qs(selectors);
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function sanitizeBrandName(text) {
    const t = normalizeText(text);
    if (!t) return "";
    if (t.length > 30) return "";
    if (t.length < 2) return "";
    if (/[。、「」\n]/.test(t)) return "";
    return t;
  }

  function cleanCandidate(text) {
    const t = normalizeText(text);
    if (!t) return "";
    const ngPhrases = [
      "メルカリ安心", "事務局に支払われ", "評価後に振り込まれます",
      "商品の編集", "出品", "商品説明",
      "メルカリでお得に通販", "誰でも安心して簡単に売り買い"
    ];
    if (t.length > 24) return "";
    if (/[。、「」]/.test(t)) return "";
    if (ngPhrases.some((p) => t.includes(p))) return "";
    return t;
  }

  function setNativeValue(el, value) {
    const lastValue = el.value;
    const prototype = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const prototypeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (prototypeSetter && valueSetter !== prototypeSetter) {
      prototypeSetter.call(el, value);
    } else if (valueSetter) {
      valueSetter.call(el, value);
    } else {
      el.value = value;
    }
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(lastValue);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "End" }));
  }

  function strongClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ behavior: "instant", block: "center" });
    } catch (_) {}
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      el.click();
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (_) { return false; }
    }
  }

  function toast(message) {
    const safeMessage = String(message || "").substring(0, 100);
    const old = document.getElementById("furima-rakuma-toast");
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = "furima-rakuma-toast";
    el.textContent = safeMessage;
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "24px";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "999999";
    el.style.background = "#222";
    el.style.color = "#fff";
    el.style.padding = "12px 16px";
    el.style.borderRadius = "999px";
    el.style.fontSize = "13px";
    el.style.maxWidth = "400px";
    el.style.boxShadow = "0 10px 24px rgba(0,0,0,.25)";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function normalizeDescription(desc, title = "") {
    let body = String(desc || "").replace(/\r/g, "").trim();
    if (!body) body = title || "";
    return body.replace(/\n{3,}/g, "\n\n");
  }

  // ------------------------------------------------------------
  // ブランド候補推測
  // ------------------------------------------------------------
  function inferBrandCandidates(title, description = "", categoryPath = "") {
    const candidates = [];
    const seen = new Set();
    const titleLower = title.toLowerCase();
    const descShort = String(description || "").substring(0, 500);
    const haystack = `${title} ${descShort} ${categoryPath}`;
    const haystackLower = haystack.toLowerCase();
    const matchedRanges = [];

    // 1. シリーズ名マッピング（実ブランドを優先）
    const seriesEntries = Object.entries(SERIES_TO_BRAND).sort((a, b) => b[0].length - a[0].length);
    for (const [series, brand] of seriesEntries) {
      const seriesLower = series.toLowerCase();
      const brandLower = brand.toLowerCase();
      if (haystackLower.includes(seriesLower)) {
        if (!seen.has(brandLower)) {
          seen.add(brandLower);
          candidates.push(brand);
        }
        const idx = titleLower.indexOf(seriesLower);
        if (idx >= 0) {
          matchedRanges.push({ start: idx, end: idx + seriesLower.length });
        }
      }
    }

    // 2. ブランド辞書マッチ（長い順優先）
    const sortedKeywords = [...BRAND_KEYWORDS].sort((a, b) => b.length - a.length);
    for (const kw of sortedKeywords) {
      const kwLower = kw.toLowerCase();
      if (haystackLower.includes(kwLower)) {
        if (!seen.has(kwLower)) {
          seen.add(kwLower);
          candidates.push(kw);
          const idx = titleLower.indexOf(kwLower);
          if (idx >= 0) {
            matchedRanges.push({ start: idx, end: idx + kwLower.length });
          }
        }
      }
    }

    function isInMatchedRange(start, end) {
      return matchedRanges.some((r) => start < r.end && end > r.start);
    }

    // 3. 英大文字連続抽出
    const upperRegex = /[A-Z][A-Za-z&'\-\.]{2,20}/g;
    let upperMatch;
    while ((upperMatch = upperRegex.exec(title)) !== null) {
      const cand = upperMatch[0].trim();
      const start = upperMatch.index;
      const end = start + cand.length;
      if (cand.length < 3 || cand.length > 20) continue;
      if (NOISE_WORDS.has(cand) || NOISE_WORDS.has(cand.toUpperCase()) || NOISE_WORDS.has(cand.toLowerCase())) continue;
      if (isInMatchedRange(start, end)) continue;
      if (!seen.has(cand.toLowerCase())) {
        seen.add(cand.toLowerCase());
        candidates.push(cand);
      }
    }

    // 4. カタカナ連続抽出
    const katakanaRegex = /[ァ-ヴー]{4,15}/g;
    let kataMatch;
    while ((kataMatch = katakanaRegex.exec(title)) !== null) {
      const cand = kataMatch[0].trim();
      const start = kataMatch.index;
      const end = start + cand.length;
      if (NOISE_WORDS.has(cand)) continue;
      if (isInMatchedRange(start, end)) continue;
      if (!seen.has(cand.toLowerCase())) {
        seen.add(cand.toLowerCase());
        candidates.push(cand);
      }
    }

    return candidates.slice(0, 5);
  }

  // ------------------------------------------------------------
  // フォーム待機・入力
  // ------------------------------------------------------------
  async function waitForRakumaForm() {
    const el = await waitForElement(
      [
        // 新フォーム(Chakra UI): 実name属性（最優先）
        'input[name="itemName"]',
        'input[name="sellPrice"]',
        'textarea[name="detail"]',
        // 新フォーム: placeholderで商品名欄を特定（価格/検索欄は除外）
        '@phTitle:文字まで',
        '@phTitle:セーター',
        // 新フォームの入力欄共通属性
        'input[data-part="input"]',
        'form input.chakra-input',
        // 旧フォーム(フォールバック)
        'input[placeholder*="40文字"]', 'input[placeholder*="商品名"]',
        'input[name="item_name"]', 'input[name="name"]'
      ],
      20000, 400
    );
    if (!el) {
      try {
        console.log("[FURIMA Rakuma] フォーム検出タイムアウト。ページ内のinput/textarea一覧:");
        [...document.querySelectorAll("input,textarea")].forEach((e, i) => {
          console.log(i, e.tagName, "name=", e.name, "ph=", e.placeholder, "class=", e.className);
        });
      } catch (_) {}
    }
    return el;
  }

  async function fillTitle(title) {
    const input = await waitForElement(
      [
        'input[name="itemName"]',
        '@phTitle:文字まで',
        '@phTitle:セーター',
        'input[placeholder*="40文字"]', 'input[placeholder*="商品名"]',
        'input[name="item_name"]', 'input[name="name"]'
      ],
      12000, 300
    );
    if (!input) return false;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);
    input.focus();
    setNativeValue(input, title);
    await sleep(500);
    return (input.value || "").trim().length > 0;
  }

  async function fillPrice(price) {
    const input = await waitForElement(
      [
        'input[name="sellPrice"]',
        'input[placeholder*="¥300"]', 'input[placeholder*="9,999,999"]',
        '@ph:9,999,999', '@ph:¥300',
        'input[placeholder*="価格"]', 'input[inputmode="numeric"]', 'input[name="price"]'
      ],
      12000, 300
    );
    if (!input) return false;
    const numeric = String(price || "").replace(/[^\d]/g, "");
    if (!numeric) return false;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);
    input.focus();
    setNativeValue(input, numeric);
    await sleep(600);
    return (input.value || "").replace(/[^\d]/g, "") === numeric;
  }

  async function fillDescription(description) {
    const textarea = await waitForElement(
      [
        'textarea[name="detail"]',
        '@phTag:textarea:記載しましょう',
        '@phTag:textarea:1000文字',
        '@phTag:textarea:注意点',
        'textarea[data-part="input"]',
        'textarea[placeholder*="商品の説明"]', 'textarea[name="description"]', "textarea"
      ],
      12000, 300
    );
    if (!textarea) return false;
    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(200);
    textarea.focus();
    setNativeValue(textarea, description);
    await sleep(500);
    return (textarea.value || "").trim().length > 0;
  }

  // ------------------------------------------------------------
  // 画像アップロード（background.js 経由）
  // ------------------------------------------------------------
  async function blobToJpegFile(blob, index) {
    const img = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
    return new File([jpegBlob], `mercari_${index + 1}.jpg`, { type: "image/jpeg" });
  }

  function isValidMercariPhotoUrl(url) {
    if (!url || typeof url !== "string") return false;
    if (!url.includes("mercdn.net")) return false;
    if (url.includes("/photos/")) return true;
    if (url.includes("photos.mercdn.net")) return true;
    return false;
  }

  // background.js 経由で画像を取得する（ページ側のCSP制限を受けず、取得失敗を防ぐため）
  async function fetchImageAsFileViaBackground(url, index) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_IMAGE_BINARY", url, index },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error((response && response.error) || "画像取得失敗"));
            return;
          }
          try {
            const bytes = new Uint8Array(response.bytes);
            const blob = new Blob([bytes], { type: response.mime || "image/jpeg" });
            const ext = (response.mime || "image/jpeg").split("/")[1] || "jpg";
            const filename = `${response.filenameBase || "mercari_" + (index + 1)}.${ext}`;
            const file = new File([blob], filename, { type: blob.type });
            resolve(file);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  async function uploadImages(imageUrls) {
    if (!Array.isArray(imageUrls) || !imageUrls.length) return false;
    imageUrls = imageUrls.filter(isValidMercariPhotoUrl);
    if (!imageUrls.length) return false;

    const fileInput = await waitForElement(['input[type="file"]'], 12000, 400);
    if (!fileInput) {
      toast("画像アップロード欄が見つかりませんでした");
      return false;
    }

    const dt = new DataTransfer();
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      try {
        const file = await fetchImageAsFileViaBackground(url, i);
        if (file.size <= 10 * 1024 * 1024) {
          dt.items.add(file);
        }
      } catch (e) {
        console.warn("画像取得失敗（background経由）:", url, e);
        // background経由で失敗した場合のフォールバック（直接fetch）
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          let file;
          if (blob.type === "image/jpeg" || blob.type === "image/png") {
            const ext = blob.type === "image/png" ? "png" : "jpg";
            file = new File([blob], `mercari_${i + 1}.${ext}`, { type: blob.type });
          } else {
            file = await blobToJpegFile(blob, i);
          }
          if (file.size <= 10 * 1024 * 1024) {
            dt.items.add(file);
          }
        } catch (e2) {
          console.warn("画像取得失敗（フォールバックも失敗）:", url, e2);
        }
      }
    }

    if (!dt.files.length) {
      toast("有効な画像が作成できませんでした");
      return false;
    }

    console.log(`[FURIMA Rakuma] 画像アップロード: ${dt.files.length}/${imageUrls.length}枚 成功`);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(2500);
    return true;
  }

  // ------------------------------------------------------------
  // 商品状態
  // ------------------------------------------------------------
  async function fillCondition(condition) {
    const candidates = CONDITION_MAP[condition] || [];
    if (!candidates.length) return false;

    const select = await waitForElement(["select"], 5000, 300);
    if (select) {
      for (const text of candidates) {
        const option = [...select.options].find(
          (o) => normalizeText(o.textContent || o.label || "") === normalizeText(text)
        );
        if (option) {
          setNativeValue(select, option.value);
          try { select.value = option.value; } catch (_) {}
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(500);
          const selectedText = normalizeText(select.options[select.selectedIndex]?.textContent || "");
          if (selectedText === normalizeText(text)) return true;
        }
      }
    }

    const candidatesEls = [...document.querySelectorAll("button, div, span, li, label")].filter(isVisible);
    const opener = candidatesEls.find((el) => {
      const t = normalizeText(el.textContent || "");
      return t.includes("商品の状態") || t.includes("商品状態");
    });
    if (opener) {
      try { opener.click(); await sleep(600); } catch (_) {}
    }

    for (const text of candidates) {
      const option = [...document.querySelectorAll("button, div, span, li, label")]
        .filter(isVisible)
        .find((el) => normalizeText(el.textContent || "") === normalizeText(text));
      if (option) {
        option.click();
        await sleep(500);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------
  // カテゴリ（表示のみ・選択は手動）
  // ------------------------------------------------------------
  function inferCategoryCandidates(title, categoryPath = "") {
    const candidates = [];
    const push = (...items) => {
      items.forEach((i) => {
        const cleaned = cleanCandidate(i);
        if (cleaned && !candidates.includes(cleaned)) {
          candidates.push(cleaned);
        }
      });
    };
    if (categoryPath) {
      categoryPath.split(">").map((s) => cleanCandidate(s.trim())).filter(Boolean).forEach((c) => push(c));
    }
    return candidates.slice(0, 8);
  }

  function getCurrentCategoryText() {
    const categoryLabel = [...document.querySelectorAll("label, div, span, p")]
      .find((el) => normalizeText(el.textContent || "") === "カテゴリ");
    if (!categoryLabel) return "";
    const block = categoryLabel.closest("section")
      || categoryLabel.parentElement?.parentElement
      || categoryLabel.parentElement;
    if (!block) return "";
    const texts = [...block.querySelectorAll("input, div, span, p, button")]
      .map((el) => normalizeText(el.textContent || el.value || ""))
      .filter(Boolean)
      .filter((t) => t !== "カテゴリ" && t !== "指定なし" && t !== "選択する");
    return texts[0] || "";
  }

  // ------------------------------------------------------------
  // ブランド欄の特定・入力
  // ------------------------------------------------------------
  function findBrandOpener() {
    const labelCandidates = [...document.querySelectorAll("label, div, span, p, h2, h3, dt")]
      .filter(isVisible)
      .filter((el) => {
        const t = normalizeText(el.textContent || "");
        if (t !== "ブランド" && t !== "ブランド名") return false;
        if (el.children.length > 2) return false;
        return true;
      });

    console.log(`[FURIMA Rakuma] brand label candidates: ${labelCandidates.length}`);

    if (labelCandidates.length === 0) {
      const fallback = [...document.querySelectorAll("label, h2, h3, dt, span, p, div")]
        .filter(isVisible)
        .filter((el) => {
          const t = normalizeText(el.textContent || "");
          return (t === "ブランド" || t === "ブランド名") && el.children.length <= 5;
        });
      if (fallback.length === 0) {
        console.log("[FURIMA Rakuma] no brand label found");
        return null;
      }
      labelCandidates.push(...fallback);
    }

    const allOpeners = [...document.querySelectorAll("div, button, span, a")]
      .filter(isVisible)
      .filter((el) => el.children.length <= 3)
      .filter((el) => {
        const t = normalizeText(el.textContent || "");
        return t === "指定なし" || t === "選択する" ||
               t.includes("ブランドを選択") || t.includes("ブランドを入力");
      });

    console.log(`[FURIMA Rakuma] all opener candidates: ${allOpeners.length}`);

    for (const label of labelCandidates) {
      const labelRect = label.getBoundingClientRect();
      const nearby = allOpeners.filter((opener) => {
        const oRect = opener.getBoundingClientRect();
        const dy = oRect.top - labelRect.top;
        const dx = Math.abs(oRect.left - labelRect.left);
        return dy >= -10 && dy <= 250 && dx <= 400;
      });
      if (nearby.length === 0) continue;

      nearby.sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const aDy = aRect.top - labelRect.top;
        const bDy = bRect.top - labelRect.top;
        if (Math.abs(aDy - bDy) > 20) return aDy - bDy;
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      });

      const chosen = nearby[0];
      const cRect = chosen.getBoundingClientRect();
      console.log(`[FURIMA Rakuma] chosen brand opener: dy=${Math.round(cRect.top - labelRect.top)}`);
      return chosen;
    }
    return null;
  }

  function findOpenBrandModal() {
    const inputs = [...document.querySelectorAll('input')]
      .filter(isVisible)
      .filter((el) => {
        const ph = el.placeholder || "";
        if (!ph) return false;
        if (!ph.includes("ブランド")) return false;
        if (ph.includes("商品名") || ph.includes("40文字") || ph.includes("価格") ||
            ph.includes("¥") || ph.includes("送料") || ph.includes("9,999")) return false;
        return true;
      });
    if (inputs.length === 0) return null;

    for (const input of inputs) {
      let el = input.parentElement;
      for (let i = 0; i < 12 && el; i++) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isLarge = rect.width >= 400 && rect.height >= 400;
        const isFixed = style.position === "fixed" || style.position === "absolute";
        if (isLarge && (isFixed || el.tagName === "DIALOG")) {
          return { container: el, searchInput: input };
        }
        el = el.parentElement;
      }
      el = input.parentElement;
      for (let i = 0; i < 8 && el; i++) {
        const rect = el.getBoundingClientRect();
        if (rect.width >= 400 && rect.height >= 400) {
          return { container: el, searchInput: input };
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  async function waitForBrandModal(timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const modal = findOpenBrandModal();
      if (modal) return modal;
      await sleep(150);
    }
    return null;
  }

  async function findModalCandidate(modalContainer, targetText, timeout = 3000) {
    if (!modalContainer) return null;
    const targetNorm = normalizeText(targetText).toLowerCase();
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const all = [...modalContainer.querySelectorAll("li, [role='option'], [role='button'], div, button, a")]
        .filter(isVisible)
        .filter((el) => el.children.length <= 6)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height >= 24 && r.height <= 120 && r.width >= 100;
        });

      const scored = all.map((el) => {
        const fullText = normalizeText(el.textContent || "");
        const firstChild = [...el.children].find((c) => normalizeText(c.textContent || "").length > 0);
        const mainText = firstChild ? normalizeText(firstChild.textContent || "") : fullText;
        return { el, fullText, mainText };
      });

      let hit = scored.find((s) => s.mainText.toLowerCase() === targetNorm);
      if (!hit) hit = scored.find((s) => s.fullText.toLowerCase() === targetNorm);
      if (!hit) hit = scored.find((s) => s.mainText.toLowerCase().includes(targetNorm) && s.mainText.length <= targetText.length + 6);
      if (!hit) hit = scored.find((s) => s.fullText.toLowerCase().startsWith(targetNorm));
      if (!hit) hit = scored.find((s) => s.fullText.toLowerCase().includes(targetNorm) && s.fullText.length <= targetText.length * 3);

      if (hit) {
        let target = hit.el;
        for (let i = 0; i < 6 && target; i++) {
          const tag = target.tagName.toLowerCase();
          const role = target.getAttribute("role") || "";
          if (tag === "li" || tag === "button" || tag === "a" || role === "option" || role === "button") {
            return target;
          }
          target = target.parentElement;
        }
        return hit.el;
      }
      await sleep(200);
    }
    return null;
  }

  async function fillBrand(brandName) {
    const safeBrand = sanitizeBrandName(brandName);
    if (!safeBrand) {
      console.log("[FURIMA Rakuma] brand invalid");
      return false;
    }
    console.log(`[FURIMA Rakuma] fillBrand start: ${safeBrand}`);

    let modal = findOpenBrandModal();

    if (!modal) {
      const opener = findBrandOpener();
      if (!opener) {
        console.log("[FURIMA Rakuma] brand opener not found - aborting");
        return false;
      }
      strongClick(opener);
      await sleep(1200);
      modal = await waitForBrandModal(4000);
      if (!modal) {
        console.log("[FURIMA Rakuma] brand modal did not open");
        return false;
      }
    } else {
      console.log("[FURIMA Rakuma] brand modal already open, reusing");
    }

    const finalPh = modal.searchInput.placeholder || "";
    if (!finalPh.includes("ブランド")) {
      console.log(`[FURIMA Rakuma] BRAND modal placeholder mismatch: "${finalPh}", abort`);
      return false;
    }

    modal.searchInput.focus();
    setNativeValue(modal.searchInput, "");
    await sleep(150);
    setNativeValue(modal.searchInput, safeBrand);
    await sleep(2000);

    const candidate = await findModalCandidate(modal.container, safeBrand, 3000);
    if (!candidate) {
      console.log(`[FURIMA Rakuma] no brand candidate for: ${safeBrand}`);
      return false;
    }

    strongClick(candidate);
    await sleep(1200);

    const stillOpen = findOpenBrandModal();
    if (stillOpen) {
      strongClick(candidate);
      await sleep(800);
    }
    return true;
  }

  // ------------------------------------------------------------
  // 入力補助パネル
  // ------------------------------------------------------------
  function removeHelperPanel() {
    const old = document.getElementById("furima-rakuma-helper");
    if (old) old.remove();
  }

  function showHelperPanel(opts) {
    const {
      categoryCandidates = [],
      currentCategory = "",
      condition = "",
      brandCandidates = [],
      autoBrandFailed = false
    } = opts;

    removeHelperPanel();

    const panel = document.createElement("div");
    panel.id = "furima-rakuma-helper";
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "999999";
    panel.style.width = "320px";
    panel.style.maxHeight = "70vh";
    panel.style.overflowY = "auto";
    panel.style.background = "#fff";
    panel.style.border = "1px solid #ddd";
    panel.style.borderRadius = "14px";
    panel.style.boxShadow = "0 12px 30px rgba(0,0,0,0.18)";
    panel.style.padding = "14px";
    panel.style.fontFamily = "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";

    const title = document.createElement("div");
    title.textContent = "📋 入力補助";
    title.style.fontSize = "15px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";
    panel.appendChild(title);

    if (currentCategory) {
      const note = document.createElement("div");
      note.style.fontSize = "12px";
      note.style.color = "#666";
      note.style.marginBottom = "10px";
      note.textContent = `現在: ${currentCategory}`;
      panel.appendChild(note);
    }

    if (condition) {
      const cond = document.createElement("div");
      cond.textContent = `📦 状態: ${condition}`;
      cond.style.fontSize = "12px";
      cond.style.fontWeight = "700";
      cond.style.color = "#333";
      cond.style.marginBottom = "12px";
      cond.style.padding = "8px";
      cond.style.background = "#f5f5f5";
      cond.style.borderRadius = "6px";
      panel.appendChild(cond);
    }

    if (brandCandidates.length > 0) {
      const brandRow = document.createElement("div");
      brandRow.style.marginBottom = "12px";
      brandRow.style.padding = "10px";
      brandRow.style.background = "#fff7f0";
      brandRow.style.border = "1px solid #ffd9b8";
      brandRow.style.borderRadius = "8px";

      const brandLabel = document.createElement("div");
      brandLabel.textContent = autoBrandFailed
        ? "🏷️ ブランド（自動入力失敗・クリックで再試行）"
        : "🏷️ ブランド候補（クリックで自動入力）";
      brandLabel.style.fontSize = "11px";
      brandLabel.style.color = "#a55";
      brandLabel.style.marginBottom = "8px";
      brandRow.appendChild(brandLabel);

      const brandWrap = document.createElement("div");
      brandWrap.style.display = "flex";
      brandWrap.style.flexWrap = "wrap";
      brandWrap.style.gap = "6px";

      brandCandidates.forEach((name) => {
        const safeName = sanitizeBrandName(name);
        if (!safeName) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = safeName;
        btn.style.border = "none";
        btn.style.borderRadius = "999px";
        btn.style.padding = "8px 14px";
        btn.style.background = "#3a86ff";
        btn.style.color = "#fff";
        btn.style.fontSize = "12px";
        btn.style.fontWeight = "700";
        btn.style.cursor = "pointer";
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toast(`「${safeName}」で検索中`);
          btn.disabled = true;
          btn.style.opacity = "0.6";
          const ok = await fillBrand(safeName);
          if (ok) {
            toast("✅ ブランドを入力しました");
            brandRow.style.display = "none";
          } else {
            toast(`「${safeName}」が見つかりませんでした`);
            btn.disabled = false;
            btn.style.opacity = "1";
          }
        });
        brandWrap.appendChild(btn);
      });

      brandRow.appendChild(brandWrap);
      panel.appendChild(brandRow);
    }

    if (categoryCandidates.length > 0) {
      const catLabel = document.createElement("div");
      catLabel.textContent = "📁 カテゴリ参考";
      catLabel.style.fontSize = "11px";
      catLabel.style.color = "#666";
      catLabel.style.marginBottom = "6px";
      panel.appendChild(catLabel);

      const catNote = document.createElement("div");
      catNote.textContent = "※ カテゴリは手動で選択してください";
      catNote.style.fontSize = "10px";
      catNote.style.color = "#999";
      catNote.style.marginBottom = "8px";
      panel.appendChild(catNote);

      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexWrap = "wrap";
      wrap.style.gap = "8px";
      wrap.style.marginBottom = "12px";

      categoryCandidates.forEach((name) => {
        const chip = document.createElement("div");
        chip.textContent = name;
        chip.style.borderRadius = "999px";
        chip.style.padding = "6px 12px";
        chip.style.background = "#f15b5b";
        chip.style.color = "#fff";
        chip.style.fontSize = "12px";
        chip.style.fontWeight = "700";
        wrap.appendChild(chip);
      });
      panel.appendChild(wrap);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "閉じる";
    close.style.marginTop = "12px";
    close.style.width = "100%";
    close.style.border = "1px solid #ddd";
    close.style.background = "#fafafa";
    close.style.borderRadius = "10px";
    close.style.padding = "10px";
    close.style.cursor = "pointer";
    close.addEventListener("click", removeHelperPanel);
    panel.appendChild(close);

    document.body.appendChild(panel);
  }

  // ------------------------------------------------------------
  // メイン処理
  // ------------------------------------------------------------
  try {
    const { mercariData } = await chrome.storage.local.get(["mercariData"]);
    if (!mercariData || !mercariData.title) {
      toast("先にメルカリ商品ページで保存してください");
      return;
    }

    const formReady = await waitForRakumaForm();
    if (!formReady) {
      toast("ラクマの出品フォームがまだ開けていません");
      return;
    }

    const title = mercariData.title || "";
    const price = mercariData.price || "";
    const description = normalizeDescription(mercariData.description || "", title);
    const images = Array.isArray(mercariData.images) ? mercariData.images.slice(0, 20) : [];
    const condition = mercariData.condition || "";
    // 管理アシストは category、Pro は categoryPath。両方に対応
    const categoryPath = mercariData.categoryPath || mercariData.category || "";
    const rawBrand = mercariData.brand || "";
    const brand = sanitizeBrandName(rawBrand);

    console.log("[FURIMA Rakuma] start", {
      brand,
      brandRawLen: rawBrand.length,
      categoryPath: categoryPath.substring(0, 50),
      descLen: (mercariData.description || "").length
    });

    const imageOk = await uploadImages(images);
    const titleOk = await fillTitle(title);
    const priceOk = await fillPrice(price);
    const descOk = await fillDescription(description);
    const conditionOk = await fillCondition(condition);

    let brandOk = false;
    let autoBrandFailed = false;
    let brandCandidates = [];

    if (brand) {
      brandOk = await fillBrand(brand);
      if (!brandOk) {
        autoBrandFailed = true;
        brandCandidates = [brand, ...inferBrandCandidates(title, mercariData.description || "", categoryPath)]
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 5);
      }
      await sleep(500);
    } else {
      brandCandidates = inferBrandCandidates(title, mercariData.description || "", categoryPath);
      console.log(`[FURIMA Rakuma] inferred brand candidates: ${brandCandidates.join(", ")}`);
    }

    const currentCategory = getCurrentCategoryText();
    const categoryCandidates = inferCategoryCandidates(title, categoryPath);

    showHelperPanel({
      categoryCandidates,
      currentCategory,
      condition,
      brandCandidates,
      autoBrandFailed
    });

    const results = [];
    if (imageOk) results.push("画像");
    if (titleOk) results.push("商品名");
    if (priceOk) results.push("価格");
    if (descOk) results.push("説明文");
    if (conditionOk) results.push("商品状態");
    if (brandOk) results.push("ブランド");

    if (results.length) {
      toast(`${results.join("・")} を入力しました`);
    } else {
      toast("入力欄が見つかりませんでした");
    }

    // ★ 管理アシスト固有：実行結果パネル用にステータスを保存（必須）
    await chrome.storage.local.set({
      rakumaFillResult: JSON.stringify({ imageOk, titleOk, priceOk, descOk, conditionOk, brandOk })
    });

    console.log("[FURIMA Rakuma] result", {
      imageOk, titleOk, priceOk, descOk, conditionOk, brandOk,
      brandCandidatesCount: brandCandidates.length
    });
  } catch (e) {
    console.error("rakuma_fill.js error:", e);
    toast("ラクマ入力中にエラーが発生しました");
  }
})();