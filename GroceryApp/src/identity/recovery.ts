/**
 * BIP39-style Recovery Code Module.
 *
 * Generates and verifies a 12-word BIP39 mnemonic phrase that encodes a
 * recovery seed (128-bit entropy). The master key is derived FROM the
 * recovery seed using crypto_generichash, ensuring a perfect round-trip:
 *
 *   generateRecoveryPhrase():
 *     seed (random 16 bytes) → crypto_generichash(32, seed) → masterKey
 *     seed → 12 BIP39 words
 *
 *   recoverFromPhrase(words):
 *     words → seed → crypto_generichash(32, seed) → SAME masterKey ✓
 *
 * This fixes the previous design which hashed the masterKey (one-way) and
 * couldn't reverse the operation, making recovery return a different key.
 *
 * Storage: recovery seed is stored encrypted via expo-secure-store.
 *          master key is stored alongside (same alias as passphrase-derived key).
 */

import { initCrypto, setMasterKey, hasMasterKey } from '../crypto/index';
// expo-secure-store loaded lazily to avoid Hermes crash (chains to expo-asset at eval time)
let SecureStore: any = null;
async function getSecureStore(): Promise<any> {
  if (!SecureStore) {
    const mod = await import('expo-secure-store');
    SecureStore = mod;
  }
  return SecureStore;
}
import { getFamilyId } from './family';

// ─── Constants ───────────────────────────────────────────────────────────────

const RECOVERY_SEED_ALIAS_PREFIX = 'groceryapp.recovery.seed.';
const RECOVERY_PHRASE_ALIAS_PREFIX = 'groceryapp.recovery.phrase.';
const RECOVERY_STORED_FLAG_PREFIX = 'groceryapp.recovery.stored.';

const ENTROPY_BYTES = 16; // 128 bits
const CHECKSUM_BITS = 4;
const TOTAL_BITS = ENTROPY_BYTES * 8 + CHECKSUM_BITS; // 132
const WORD_COUNT = 12;
const BITS_PER_WORD = 11;

// ─── BIP39 English Wordlist (2048 words) ────────────────────────────────────

const BIP39_WORDLIST: readonly string[] = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
  'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
  'action', 'actor', 'actress', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit',
  'adult', 'advance', 'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album', 'alcohol', 'alert',
  'alien', 'all', 'alley', 'allow', 'almost', 'alone', 'alpha', 'already', 'also', 'alter',
  'always', 'amateur', 'amazing', 'among', 'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger',
  'angle', 'angry', 'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april', 'arch', 'arctic',
  'area', 'arena', 'argue', 'arm', 'armed', 'armor', 'army', 'around', 'arrange', 'arrest',
  'arrive', 'arrow', 'art', 'artefact', 'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset',
  'assist', 'assume', 'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
  'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado', 'avoid', 'awake',
  'aware', 'away', 'awesome', 'awful', 'awkward', 'axis', 'baby', 'bachelor', 'bacon', 'badge',
  'bag', 'balance', 'balcony', 'ball', 'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain',
  'barrel', 'base', 'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become',
  'beef', 'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt', 'bench', 'benefit',
  'best', 'betray', 'better', 'between', 'beyond', 'bicycle', 'bid', 'bike', 'bind', 'biology',
  'bird', 'birth', 'bitter', 'black', 'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless',
  'blind', 'blood', 'blossom', 'blouse', 'blue', 'blur', 'blush', 'board', 'boat', 'body',
  'boil', 'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring', 'borrow', 'boss',
  'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain', 'brand', 'brass', 'brave', 'bread',
  'breeze', 'brick', 'bridge', 'brief', 'bright', 'bring', 'brisk', 'broccoli', 'broken', 'bronze',
  'broom', 'brother', 'brown', 'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb',
  'bulk', 'bullet', 'bundle', 'bunker', 'burden', 'burger', 'burst', 'bus', 'business', 'busy',
  'butter', 'buyer', 'buzz', 'cabbage', 'cabin', 'cable', 'cactus', 'cage', 'cake', 'call',
  'calm', 'camera', 'camp', 'can', 'canal', 'cancel', 'candy', 'cannon', 'canoe', 'canvas',
  'canyon', 'capable', 'capital', 'captain', 'car', 'carbon', 'card', 'cargo', 'carpet', 'carry',
  'cart', 'case', 'cash', 'casino', 'castle', 'casual', 'cat', 'catalog', 'catch', 'category',
  'cattle', 'caught', 'cause', 'caution', 'cave', 'ceiling', 'celery', 'cement', 'census', 'century',
  'cereal', 'certain', 'chair', 'chalk', 'champion', 'change', 'chaos', 'chapter', 'charge', 'chase',
  'chat', 'cheap', 'check', 'cheese', 'chef', 'cherry', 'chest', 'chicken', 'chief', 'child',
  'chimney', 'choice', 'choose', 'chronic', 'chuckle', 'chunk', 'churn', 'cigar', 'cinnamon', 'circle',
  'citizen', 'city', 'civil', 'claim', 'clap', 'clarify', 'claw', 'clay', 'clean', 'clerk',
  'clever', 'click', 'client', 'cliff', 'climb', 'clinic', 'clip', 'clock', 'clog', 'close',
  'cloth', 'cloud', 'clown', 'club', 'clump', 'cluster', 'clutch', 'coach', 'coast', 'coconut',
  'code', 'coffee', 'coil', 'coin', 'collect', 'color', 'column', 'combine', 'come', 'comfort',
  'comic', 'common', 'company', 'concert', 'conduct', 'confirm', 'congress', 'connect', 'consider', 'control',
  'convince', 'cook', 'cool', 'copper', 'copy', 'coral', 'core', 'corn', 'correct', 'cost',
  'cotton', 'couch', 'country', 'couple', 'course', 'cousin', 'cover', 'coyote', 'crack', 'cradle',
  'craft', 'crane', 'crash', 'crater', 'crawl', 'crazy', 'cream', 'credit', 'creek', 'crew',
  'cricket', 'crime', 'crisp', 'critic', 'crop', 'cross', 'crouch', 'crowd', 'crucial', 'cruel',
  'cruise', 'crumble', 'crunch', 'crush', 'cry', 'crystal', 'cube', 'culture', 'cup', 'cupboard',
  'curious', 'current', 'curtain', 'curve', 'cushion', 'custom', 'cute', 'cycle', 'dad', 'damage',
  'damp', 'dance', 'danger', 'daring', 'dash', 'daughter', 'dawn', 'day', 'deal', 'debate',
  'debris', 'decade', 'december', 'decide', 'decline', 'decorate', 'decrease', 'deer', 'defense', 'define',
  'defy', 'degree', 'delay', 'deliver', 'demand', 'demise', 'denial', 'dentist', 'deny', 'depart',
  'depend', 'deposit', 'depth', 'deputy', 'derive', 'describe', 'desert', 'design', 'desk', 'despair',
  'destroy', 'detail', 'detect', 'develop', 'device', 'devote', 'diagram', 'dial', 'diamond', 'diary',
  'dice', 'diesel', 'diet', 'differ', 'digital', 'dignity', 'dilemma', 'dinner', 'dinosaur', 'direct',
  'dirt', 'disagree', 'discover', 'disease', 'dish', 'dismiss', 'disorder', 'display', 'distance', 'divert',
  'divide', 'divorce', 'dizzy', 'doctor', 'document', 'dog', 'doll', 'dolphin', 'domain', 'donate',
  'donkey', 'donor', 'door', 'dose', 'double', 'dove', 'draft', 'dragon', 'drama', 'drastic',
  'draw', 'dream', 'dress', 'drift', 'drill', 'drink', 'drip', 'drive', 'drop', 'drum',
  'dry', 'duck', 'dumb', 'dune', 'during', 'dust', 'dutch', 'duty', 'dwarf', 'dynamic',
  'eager', 'eagle', 'early', 'earn', 'earth', 'easily', 'east', 'easy', 'echo', 'ecology',
  'economy', 'edge', 'edit', 'educate', 'effort', 'egg', 'eight', 'either', 'elbow', 'elder',
  'electric', 'elegant', 'element', 'elephant', 'elevator', 'elite', 'else', 'embryo', 'emerge', 'emotion',
  'emperor', 'employ', 'empty', 'enable', 'end', 'enemy', 'energy', 'enforce', 'engage', 'engine',
  'enhance', 'enjoy', 'enlist', 'enough', 'enrich', 'enroll', 'ensure', 'enter', 'entire', 'entry',
  'envelope', 'episode', 'equal', 'equip', 'era', 'erase', 'erode', 'erosion', 'error', 'erupt',
  'escape', 'essay', 'essence', 'estate', 'eternal', 'ethics', 'evidence', 'evil', 'evoke', 'evolve',
  'exact', 'example', 'exceed', 'exchange', 'excite', 'exclude', 'excuse', 'execute', 'exercise', 'exhaust',
  'exhibit', 'exile', 'exist', 'exit', 'exotic', 'expand', 'expect', 'expire', 'explain', 'expose',
  'express', 'extend', 'extra', 'eye', 'eyebrow', 'fabric', 'face', 'faculty', 'fade', 'faint',
  'faith', 'fall', 'false', 'fame', 'family', 'famous', 'fan', 'fancy', 'fantasy', 'farm',
  'fashion', 'fat', 'fatal', 'father', 'fatigue', 'fault', 'favorite', 'feature', 'february', 'federal',
  'fee', 'feed', 'feel', 'female', 'fence', 'festival', 'fetch', 'fever', 'few', 'fiber',
  'fiction', 'field', 'figure', 'file', 'film', 'filter', 'final', 'find', 'fine', 'finger',
  'finish', 'fire', 'firm', 'first', 'fiscal', 'fish', 'fit', 'fitness', 'fix', 'flag',
  'flame', 'flash', 'flat', 'flavor', 'flee', 'flight', 'flip', 'float', 'flock', 'floor',
  'flower', 'fluid', 'flush', 'fly', 'foam', 'focus', 'fog', 'foil', 'fold', 'follow',
  'food', 'foot', 'force', 'foreign', 'forest', 'forget', 'fork', 'fortune', 'forum', 'forward',
  'fossil', 'foster', 'found', 'fox', 'fragile', 'frame', 'frequent', 'fresh', 'friend', 'fringe',
  'frog', 'front', 'frost', 'frown', 'frozen', 'fruit', 'fuel', 'fun', 'funny', 'furnace',
  'fury', 'future', 'gadget', 'gain', 'galaxy', 'gallery', 'game', 'gap', 'garage', 'garbage',
  'garden', 'garlic', 'garment', 'gas', 'gasp', 'gate', 'gather', 'gauge', 'gaze', 'general',
  'genius', 'genre', 'gentle', 'genuine', 'gesture', 'ghost', 'giant', 'gift', 'giggle', 'ginger',
  'giraffe', 'girl', 'give', 'glad', 'glance', 'glare', 'glass', 'glide', 'glimpse', 'globe',
  'gloom', 'glory', 'glove', 'glow', 'glue', 'goat', 'goddess', 'gold', 'good', 'goose',
  'gorilla', 'gospel', 'gossip', 'govern', 'gown', 'grab', 'grace', 'grain', 'grant', 'grape',
  'grass', 'gravity', 'great', 'green', 'grid', 'grief', 'grit', 'grocery', 'group', 'grow',
  'grunt', 'guard', 'guess', 'guide', 'guilt', 'guitar', 'gun', 'gym', 'habit', 'hair',
  'half', 'hammer', 'hamster', 'hand', 'happy', 'harbor', 'hard', 'harsh', 'harvest', 'hat',
  'have', 'hawk', 'hazard', 'head', 'health', 'heart', 'heavy', 'hedgehog', 'height', 'hello',
  'helmet', 'help', 'hen', 'hero', 'hidden', 'high', 'hill', 'hint', 'hip', 'hire',
  'history', 'hobby', 'hockey', 'hold', 'hole', 'holiday', 'hollow', 'home', 'honey', 'hood',
  'hope', 'horn', 'horror', 'horse', 'hospital', 'host', 'hotel', 'hour', 'hover', 'hub',
  'human', 'humble', 'humor', 'hundred', 'hungry', 'hunt', 'hurdle', 'hurry', 'hurt', 'husband',
  'hybrid', 'ice', 'icon', 'idea', 'identify', 'idle', 'ignore', 'ill', 'illegal', 'illness',
  'image', 'imitate', 'immense', 'immune', 'impact', 'impose', 'improve', 'impulse', 'inch', 'include',
  'income', 'increase', 'index', 'indicate', 'indoor', 'industry', 'infant', 'inflict', 'inform', 'inhale',
  'inherit', 'initial', 'inject', 'injury', 'inmate', 'inner', 'innocent', 'input', 'inquiry', 'insane',
  'insect', 'inside', 'inspire', 'install', 'intact', 'interest', 'into', 'invest', 'invite', 'involve',
  'iron', 'island', 'isolate', 'issue', 'item', 'ivory', 'jacket', 'jaguar', 'jar', 'jazz',
  'jealous', 'jeans', 'jelly', 'jewel', 'job', 'join', 'joke', 'journey', 'joy', 'judge',
  'juice', 'jump', 'jungle', 'junior', 'junk', 'just', 'kangaroo', 'keen', 'keep', 'ketchup',
  'key', 'kick', 'kid', 'kidney', 'kind', 'kingdom', 'kiss', 'kit', 'kitchen', 'kite',
  'kitten', 'kiwi', 'knee', 'knife', 'knock', 'know', 'lab', 'label', 'labor', 'ladder',
  'lady', 'lake', 'lamp', 'language', 'laptop', 'large', 'later', 'latin', 'laugh', 'laundry',
  'lava', 'law', 'lawn', 'lawsuit', 'layer', 'lazy', 'leader', 'leaf', 'learn', 'leave',
  'lecture', 'left', 'leg', 'legal', 'legend', 'leisure', 'lemon', 'lend', 'length', 'lens',
  'leopard', 'lesson', 'letter', 'level', 'liar', 'liberty', 'library', 'license', 'life', 'lift',
  'light', 'like', 'limb', 'limit', 'link', 'lion', 'liquid', 'list', 'little', 'live',
  'lizard', 'load', 'loan', 'lobster', 'local', 'lock', 'logic', 'lonely', 'long', 'loop',
  'lottery', 'loud', 'lounge', 'love', 'loyal', 'lucky', 'luggage', 'lumber', 'lunar', 'lunch',
  'luxury', 'lyrics', 'machine', 'mad', 'magic', 'magnet', 'maid', 'mail', 'main', 'major',
  'make', 'mammal', 'man', 'manage', 'mandate', 'mango', 'mansion', 'manual', 'maple', 'marble',
  'march', 'margin', 'marine', 'market', 'marriage', 'mask', 'mass', 'master', 'match', 'material',
  'math', 'matrix', 'matter', 'maximum', 'maze', 'meadow', 'mean', 'measure', 'meat', 'mechanic',
  'medal', 'media', 'melody', 'melt', 'member', 'memory', 'mention', 'menu', 'mercy', 'merge',
  'merit', 'merry', 'mesh', 'message', 'metal', 'method', 'middle', 'midnight', 'milk', 'million',
  'mimic', 'mind', 'minimum', 'minor', 'minute', 'miracle', 'mirror', 'misery', 'miss', 'mistake',
  'mix', 'mixed', 'mixture', 'mobile', 'model', 'modify', 'mom', 'moment', 'monitor', 'monkey',
  'monster', 'month', 'moon', 'moral', 'more', 'morning', 'mosquito', 'mother', 'motion', 'motor',
  'mountain', 'mouse', 'move', 'movie', 'much', 'muffin', 'mule', 'multiply', 'muscle', 'museum',
  'mushroom', 'music', 'must', 'mutual', 'myself', 'mystery', 'myth', 'naive', 'name', 'napkin',
  'narrow', 'nasty', 'nation', 'nature', 'near', 'neck', 'need', 'negative', 'neglect', 'neither',
  'nephew', 'nerve', 'nest', 'net', 'network', 'neutral', 'never', 'news', 'next', 'nice',
  'night', 'noble', 'noise', 'nominee', 'noodle', 'normal', 'north', 'nose', 'notable', 'note',
  'nothing', 'notice', 'novel', 'now', 'nuclear', 'number', 'nurse', 'nut', 'oak', 'obey',
  'object', 'oblige', 'obscure', 'observe', 'obtain', 'obvious', 'occur', 'ocean', 'october', 'odor',
  'off', 'offer', 'office', 'often', 'oil', 'okay', 'old', 'olive', 'olympic', 'omit',
  'once', 'one', 'onion', 'online', 'only', 'open', 'opera', 'opinion', 'oppose', 'option',
  'orange', 'orbit', 'orchard', 'order', 'ordinary', 'organ', 'orient', 'original', 'orphan', 'ostrich',
  'other', 'outdoor', 'outer', 'output', 'outside', 'oval', 'oven', 'over', 'own', 'owner',
  'oxygen', 'oyster', 'ozone', 'pact', 'paddle', 'page', 'pair', 'palace', 'palm', 'panda',
  'panel', 'panic', 'panther', 'paper', 'parade', 'parent', 'park', 'parrot', 'party', 'pass',
  'patch', 'path', 'patient', 'patrol', 'pattern', 'pause', 'pave', 'payment', 'peace', 'peanut',
  'pear', 'peasant', 'pelican', 'pen', 'penalty', 'pencil', 'people', 'pepper', 'perfect', 'permit',
  'person', 'pet', 'phone', 'photo', 'phrase', 'physical', 'piano', 'picnic', 'picture', 'piece',
  'pig', 'pigeon', 'pill', 'pilot', 'pink', 'pioneer', 'pipe', 'pistol', 'pitch', 'pizza',
  'place', 'planet', 'plastic', 'plate', 'play', 'player', 'please', 'pledge', 'pluck', 'plug',
  'plunge', 'poem', 'poet', 'point', 'polar', 'pole', 'police', 'pond', 'pony', 'pool',
  'popular', 'portion', 'position', 'possible', 'post', 'potato', 'pottery', 'poverty', 'powder', 'power',
  'practice', 'praise', 'predict', 'prefer', 'prepare', 'present', 'pretty', 'prevent', 'price', 'pride',
  'primary', 'print', 'priority', 'prison', 'private', 'prize', 'problem', 'process', 'produce', 'profit',
  'program', 'project', 'promote', 'proof', 'property', 'prosper', 'protect', 'proud', 'provide', 'public',
  'pudding', 'pull', 'pulp', 'pulse', 'pumpkin', 'punch', 'pupil', 'puppy', 'purchase', 'purity',
  'purpose', 'purse', 'push', 'put', 'puzzle', 'pyramid', 'quality', 'quantum', 'quarter', 'question',
  'quick', 'quit', 'quiz', 'quote', 'rabbit', 'raccoon', 'race', 'rack', 'radar', 'radio',
  'rail', 'rain', 'raise', 'rally', 'ramp', 'ranch', 'random', 'range', 'rapid', 'rare',
  'rate', 'rather', 'raven', 'raw', 'razor', 'ready', 'real', 'reason', 'rebel', 'rebuild',
  'recall', 'receive', 'recipe', 'record', 'recycle', 'reduce', 'reflect', 'reform', 'refuse', 'region',
  'regret', 'regular', 'reject', 'relax', 'release', 'relief', 'rely', 'remain', 'remember', 'remind',
  'remove', 'render', 'renew', 'rent', 'reopen', 'repair', 'repeat', 'replace', 'report', 'require',
  'rescue', 'resemble', 'resist', 'resource', 'response', 'result', 'retire', 'retreat', 'return', 'reunion',
  'reveal', 'review', 'reward', 'rhythm', 'rib', 'ribbon', 'rice', 'rich', 'ride', 'ridge',
  'rifle', 'right', 'rigid', 'ring', 'riot', 'rip', 'ripe', 'risk', 'rival', 'river',
  'road', 'roast', 'robot', 'robust', 'rocket', 'romance', 'roof', 'rookie', 'room', 'rose',
  'rotate', 'rough', 'round', 'route', 'royal', 'rubber', 'rude', 'rug', 'rule', 'run',
  'runway', 'rural', 'sad', 'saddle', 'sadness', 'safe', 'sail', 'salad', 'salmon', 'salon',
  'salt', 'salute', 'same', 'sample', 'sand', 'satisfy', 'satoshi', 'sauce', 'sausage', 'save',
  'say', 'scale', 'scan', 'scare', 'scatter', 'scene', 'scheme', 'school', 'science', 'scissors',
  'scorpion', 'scout', 'scrap', 'screen', 'script', 'scrub', 'sea', 'search', 'season', 'seat',
  'second', 'secret', 'section', 'security', 'seed', 'seek', 'segment', 'select', 'sell', 'seminar',
  'senior', 'sense', 'sentence', 'series', 'service', 'session', 'settle', 'setup', 'seven', 'shadow',
  'shaft', 'shallow', 'share', 'shed', 'shell', 'sheriff', 'shield', 'shift', 'shine', 'ship',
  'shiver', 'shock', 'shoe', 'shoot', 'shop', 'short', 'shoulder', 'shove', 'shrimp', 'shrug',
  'shuffle', 'shy', 'sibling', 'sick', 'side', 'siege', 'sight', 'sign', 'silent', 'silk',
  'silly', 'silver', 'similar', 'simple', 'since', 'sing', 'siren', 'sister', 'situate', 'six',
  'size', 'skate', 'sketch', 'ski', 'skill', 'skin', 'skirt', 'skull', 'slab', 'slam',
  'sleep', 'slender', 'slice', 'slide', 'slight', 'slim', 'slogan', 'slot', 'slow', 'slush',
  'small', 'smart', 'smile', 'smoke', 'smooth', 'snack', 'snake', 'snap', 'sniff', 'snow',
  'soap', 'soccer', 'social', 'sock', 'soda', 'soft', 'solar', 'soldier', 'solid', 'solution',
  'solve', 'someone', 'song', 'soon', 'sorry', 'sort', 'soul', 'sound', 'soup', 'source',
  'south', 'space', 'spare', 'spatial', 'spawn', 'speak', 'special', 'speed', 'spell', 'spend',
  'sphere', 'spice', 'spider', 'spike', 'spin', 'spirit', 'split', 'spoil', 'sponsor', 'spoon',
  'sport', 'spot', 'spray', 'spread', 'spring', 'spy', 'square', 'squeeze', 'squirrel', 'stable',
  'stadium', 'staff', 'stage', 'stairs', 'stamp', 'stand', 'start', 'state', 'stay', 'steak',
  'steel', 'step', 'stereo', 'stick', 'still', 'sting', 'stock', 'stomach', 'stone', 'stool',
  'story', 'stove', 'strategy', 'street', 'strike', 'strong', 'struggle', 'student', 'stuff', 'stumble',
  'style', 'subject', 'submit', 'subway', 'success', 'such', 'sudden', 'suffer', 'sugar', 'suggest',
  'suit', 'sun', 'sunny', 'sunset', 'super', 'supply', 'support', 'suppose', 'sure', 'surface',
  'surge', 'surprise', 'surround', 'survey', 'suspect', 'sustain', 'swallow', 'swamp', 'swap', 'swarm',
  'swear', 'sweet', 'swift', 'swim', 'swing', 'switch', 'sword', 'symbol', 'symptom', 'syrup',
  'system', 'table', 'tackle', 'tag', 'tail', 'talent', 'talk', 'tank', 'tape', 'target',
  'task', 'taste', 'tattoo', 'taxi', 'teach', 'team', 'tell', 'ten', 'tenant', 'tennis',
  'tent', 'term', 'test', 'text', 'thank', 'that', 'theme', 'then', 'theory', 'there',
  'they', 'thing', 'this', 'thought', 'three', 'thrive', 'throw', 'thumb', 'thunder', 'ticket',
  'tide', 'tiger', 'tilt', 'timber', 'time', 'tiny', 'tip', 'tired', 'tissue', 'title',
  'toast', 'tobacco', 'today', 'toddler', 'toe', 'together', 'toilet', 'token', 'tomato', 'tomorrow',
  'tone', 'tongue', 'tonight', 'tool', 'tooth', 'top', 'topic', 'topple', 'torch', 'tornado',
  'tortoise', 'toss', 'total', 'tourist', 'toward', 'tower', 'town', 'toy', 'track', 'trade',
  'traffic', 'tragic', 'train', 'transfer', 'trap', 'trash', 'travel', 'tray', 'treat', 'tree',
  'trend', 'trial', 'tribe', 'trick', 'trigger', 'trim', 'trip', 'trophy', 'trouble', 'truck',
  'true', 'truly', 'trumpet', 'trust', 'truth', 'try', 'tube', 'tuition', 'tumble', 'tuna',
  'tunnel', 'turkey', 'turn', 'turtle', 'twelve', 'twenty', 'twice', 'twin', 'twist', 'two',
  'type', 'typical', 'ugly', 'umbrella', 'unable', 'unaware', 'uncle', 'uncover', 'under', 'undo',
  'unfair', 'unfold', 'unhappy', 'uniform', 'unique', 'unit', 'universe', 'unknown', 'unlock', 'until',
  'unusual', 'unveil', 'update', 'upgrade', 'uphold', 'upon', 'upper', 'upset', 'urban', 'urge',
  'usage', 'use', 'used', 'useful', 'useless', 'usual', 'utility', 'vacant', 'vacuum', 'vague',
  'valid', 'valley', 'valve', 'van', 'vanish', 'vapor', 'various', 'vast', 'vault', 'vehicle',
  'velvet', 'vendor', 'venture', 'venue', 'verb', 'verify', 'version', 'very', 'vessel', 'veteran',
  'viable', 'vibrant', 'vicious', 'victory', 'video', 'view', 'village', 'vintage', 'violin', 'virtual',
  'virus', 'visa', 'visit', 'visual', 'vital', 'vivid', 'vocal', 'voice', 'void', 'volcano',
  'volume', 'vote', 'voyage', 'wage', 'wagon', 'wait', 'walk', 'wall', 'walnut', 'want',
  'warfare', 'warm', 'warrior', 'wash', 'wasp', 'waste', 'water', 'wave', 'way', 'wealth',
  'weapon', 'wear', 'weasel', 'weather', 'web', 'wedding', 'weekend', 'weird', 'welcome', 'west',
  'wet', 'whale', 'what', 'wheat', 'wheel', 'when', 'where', 'whip', 'whisper', 'wide',
  'width', 'wife', 'wild', 'will', 'win', 'window', 'wine', 'wing', 'wink', 'winner',
  'winter', 'wire', 'wisdom', 'wise', 'wish', 'witness', 'wolf', 'woman', 'wonder', 'wood',
  'wool', 'word', 'work', 'world', 'worry', 'worth', 'wrap', 'wreck', 'wrestle', 'wrist',
  'write', 'wrong', 'yard', 'year', 'yellow', 'you', 'young', 'youth', 'zebra', 'zero',
  'zone', 'zoo',
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a lookup Set from the BIP39 wordlist for O(1) validation.
 */
function createWordlistSet(): Set<string> {
  return new Set(BIP39_WORDLIST);
}

/**
 * Convert 128 bits (16 bytes) + 4-bit checksum into 12 word indices.
 * Each word index is 11 bits.
 *
 * @internal Exported for testing only.
 */
export function entropyToWordIndices(entropy: Uint8Array): number[] {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error(`Entropy must be ${ENTROPY_BYTES} bytes`);
  }

  // Calculate checksum: first CHECKSUM_BITS bits of SHA-256 of entropy
  const sodium = require('react-native-libsodium');
  const hash = sodium.crypto_hash_sha256(entropy);
  const checksum = hash[0] >> (8 - CHECKSUM_BITS); // top CHECKSUM_BITS bits

  // Build a 132-bit big-endian buffer: 128 bits entropy + 4 bits checksum
  // The checksum sits immediately after the entropy (bits 128-131).
  //
  // Approach: treat the buffer as a single big-endian number and extract
  // 11-bit chunks using BigInt to avoid all manual bit-twiddling errors.

  // Build entropy as BigInt (16 bytes → 128 bits)
  let buffer = 0n;
  for (let i = 0; i < ENTROPY_BYTES; i++) {
    buffer = (buffer << 8n) | BigInt(entropy[i]);
  }
  // Append checksum (4 bits)
  buffer = (buffer << 4n) | BigInt(checksum);

  // Extract 12 words × 11 bits each, from MSB to LSB
  const indices: number[] = [];
  for (let w = 0; w < WORD_COUNT; w++) {
    const shiftBits = BigInt(TOTAL_BITS - (w + 1) * BITS_PER_WORD);
    const word = Number((buffer >> shiftBits) & 0x7FFn);
    indices.push(word);
  }

  return indices;
}

/**
 * Convert 12 word indices back to 128-bit entropy.
 * Validates checksum during the conversion.
 *
 * @internal Exported for testing only.
 */
export function wordIndicesToEntropy(indices: number[]): Uint8Array {
  if (indices.length !== WORD_COUNT) {
    throw new Error(`Expected ${WORD_COUNT} word indices, got ${indices.length}`);
  }

  // Reconstruct the 132-bit value from 11-bit chunks using BigInt
  let buffer = 0n;
  for (let w = 0; w < WORD_COUNT; w++) {
    const index = indices[w];
    if (index < 0 || index >= 2048) {
      throw new Error(`Word index out of range: ${index}`);
    }
    buffer = (buffer << 11n) | BigInt(index);
  }

  // Extract entropy: top 128 bits (16 bytes)
  const entropy = new Uint8Array(ENTROPY_BYTES);
  const entropyBuffer = buffer >> 4n; // Remove checksum (bottom 4 bits)
  for (let i = 0; i < ENTROPY_BYTES; i++) {
    const shiftBits = BigInt((ENTROPY_BYTES - 1 - i) * 8);
    entropy[i] = Number((entropyBuffer >> shiftBits) & 0xFFn);
  }

  // Extract stored checksum (bottom 4 bits of the 132-bit value)
  const storedChecksum = Number(buffer & 0xFn);

  // Verify checksum
  const sodium = require('react-native-libsodium');
  const hash = sodium.crypto_hash_sha256(entropy);
  const expectedChecksum = hash[0] >> (8 - CHECKSUM_BITS);

  if (storedChecksum !== expectedChecksum) {
    throw new Error('Recovery phrase checksum mismatch — phrase is invalid or corrupted');
  }

  return entropy;
}

// ─── Recovery Seed Management ────────────────────────────────────────────────

/**
 * Get the stored recovery seed for a family.
 * Returns null if no seed has been generated yet.
 */
async function getRecoverySeed(familyId: string): Promise<Uint8Array | null> {
  try {
    const stored = await (await getSecureStore()).getItemAsync(
      `${RECOVERY_SEED_ALIAS_PREFIX}${familyId}`,
    );
    if (!stored) return null;
    return new Uint8Array(stored.split(',').map((s: string) => parseInt(s, 10)));
  } catch {
    return null;
  }
}

/**
 * Store a recovery seed for a family.
 */
async function setRecoverySeed(familyId: string, seed: Uint8Array): Promise<void> {
  await (await getSecureStore()).setItemAsync(
    `${RECOVERY_SEED_ALIAS_PREFIX}${familyId}`,
    Array.from(seed).join(','),
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a 12-word BIP39 recovery phrase from a fresh random seed.
 *
 * The recovery seed (16 random bytes) is the ROOT entropy. The master key
 * is derived FROM the seed via crypto_generichash(32, seed), ensuring that
 * recovery produces the exact same master key as the original setup.
 *
 * This is a fundamental fix for the previous design which hashed the master
 * key (one-way operation) and couldn't reverse it, making recovery return
 * a completely different key (DATA LOSS bug).
 *
 * When this function is called, it:
 *   1. Generates 16 random bytes (recovery seed)
 *   2. Hashes the seed to derive the master key (crypto_generichash)
 *   3. Stores both the seed and the master key in SecureStore
 *   4. Encodes the seed as 12 BIP39 words
 *   5. Returns the phrase
 *
 * NOTE: This REPLACES the existing master key (if any) with a recovery-derived
 * key. The previous passphrase-derived key is no longer used. This means
 * data encrypted with the old key must be re-encrypted or re-created.
 * Since the previous recovery system was completely broken (C1 — data loss),
 * this is not a functional regression.
 *
 * @returns The 12-word recovery phrase as a space-separated string.
 * @throws If no family membership is found.
 */
export async function generateRecoveryPhrase(): Promise<string> {
  await initCrypto();
  const sodium = require('react-native-libsodium');
  await sodium.ready;

  const familyId = await getFamilyId();
  if (!familyId) {
    throw new Error('No family membership found.');
  }

  // Guard: prevent overwriting an existing master key
  // The two-key-root issue (recovery key vs passphrase-derived key) is not
  // yet reconciled. Overwriting would orphan all encrypted data.
  if (await hasMasterKey()) {
    throw new Error(
      'Cannot generate recovery phrase after data has been encrypted. ' +
      'Recovery phrase must be created during family setup.',
    );
  }

  // Generate 16 bytes of fresh random entropy as the recovery seed
  const entropy = sodium.randombytes_buf(ENTROPY_BYTES);

  // Derive the master key FROM the recovery seed using crypto_generichash
  // This is a one-way derivation, BUT the forward and reverse paths both
  // use the same operation: seed → hash → masterKey. Recovery decodes the
  // phrase back to the seed, then re-applies the same hash → same key.
  const masterKey = sodium.crypto_generichash(32, entropy);

  // Store the master key (overwrites any passphrase-derived key)
  await setMasterKey(masterKey);

  // Store the recovery seed for later display/verification
  await setRecoverySeed(familyId, entropy);

  // Encode entropy to word indices
  const indices = entropyToWordIndices(entropy);

  // Map to words
  const words = indices.map((i) => BIP39_WORDLIST[i]);
  const phrase = words.join(' ');

  // Store the phrase (encrypted) for later verification
  await (await getSecureStore()).setItemAsync(
    `${RECOVERY_PHRASE_ALIAS_PREFIX}${familyId}`,
    phrase,
  );
  await (await getSecureStore()).setItemAsync(
    `${RECOVERY_STORED_FLAG_PREFIX}${familyId}`,
    'true',
  );

  return phrase;
}

/**
 * Recover the master key from a 12-word BIP39 recovery phrase.
 *
 * The recovery phrase encodes the recovery seed (16 bytes of entropy).
 * This function:
 *   1. Decodes the words back to the 16-byte seed
 *   2. Hashes the seed via crypto_generichash(32, seed) to derive the
 *      exact same 32-byte master key that was generated during setup
 *   3. Stores the master key in SecureStore
 *
 * Round-trip guarantee:
 *   generateRecoveryPhrase() → phrase
 *   recoverFromPhrase(phrase) → SAME master key ✓
 *
 * @param phrase - Space-separated 12-word BIP39 recovery phrase.
 * @returns The recovered master key as a Uint8Array.
 * @throws If the phrase is invalid (wrong word count, unknown words, bad checksum).
 */
export async function recoverFromPhrase(phrase: string): Promise<Uint8Array> {
  await initCrypto();
  const sodium = require('react-native-libsodium');
  await sodium.ready;

  // Validate the phrase first
  const validation = verifyRecoveryPhrase(phrase);
  if (!validation) {
    throw new Error('Invalid recovery phrase. Check word count, spelling, and word list.');
  }

  // Parse words to indices
  const words = phrase.trim().toLowerCase().split(/\s+/);
  const wordlistSet = createWordlistSet();
  const indices: number[] = [];

  for (const word of words) {
    if (!wordlistSet.has(word)) {
      throw new Error(`Word "${word}" is not in the BIP39 wordlist`);
    }
    const idx = BIP39_WORDLIST.indexOf(word);
    if (idx === -1) {
      throw new Error(`Word "${word}" not found in wordlist`);
    }
    indices.push(idx);
  }

  // Recover entropy from indices (validates checksum)
  const entropy = wordIndicesToEntropy(indices);

  // Derive the master key from the recovery seed using crypto_generichash
  // This produces the EXACT same 32-byte key as generateRecoveryPhrase()
  const masterKey = sodium.crypto_generichash(32, entropy);

  // Store the recovered master key in SecureStore (overwrites old key if any)
  await setMasterKey(masterKey);

  return masterKey;
}

/**
 * Quick validation of a recovery phrase.
 * Checks word count, all words in BIP39 wordlist, and checksum validity.
 *
 * @param phrase - The recovery phrase to validate.
 * @returns true if the phrase is valid, false otherwise.
 */
export function verifyRecoveryPhrase(phrase: string): boolean {
  try {
    if (!phrase || typeof phrase !== 'string') return false;

    const words = phrase.trim().toLowerCase().split(/\s+/);

    // Must be exactly 12 words
    if (words.length !== WORD_COUNT) return false;

    // All words must be in the BIP39 wordlist
    const wordlistSet = createWordlistSet();
    for (const word of words) {
      if (!wordlistSet.has(word)) return false;
    }

    // Convert to indices
    const indices = words.map((w) => BIP39_WORDLIST.indexOf(w));
    if (indices.some((i) => i === -1)) return false;

    // Verify checksum (will throw if invalid)
    wordIndicesToEntropy(indices);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a recovery phrase has been generated and stored for this family.
 *
 * @returns true if a recovery phrase exists.
 */
export async function hasRecoveryPhrase(): Promise<boolean> {
  try {
    const familyId = await getFamilyId();
    if (!familyId) return false;

    const stored = await (await getSecureStore()).getItemAsync(
      `${RECOVERY_STORED_FLAG_PREFIX}${familyId}`,
    );
    return stored === 'true';
  } catch {
    return false;
  }
}

/**
 * Get the stored recovery phrase (for display purposes).
 * Requires confirmation before showing to the user.
 *
 * @returns The stored recovery phrase, or null if not generated yet.
 */
export async function getStoredRecoveryPhrase(): Promise<string | null> {
  try {
    const familyId = await getFamilyId();
    if (!familyId) return null;

    const phrase = await (await getSecureStore()).getItemAsync(
      `${RECOVERY_PHRASE_ALIAS_PREFIX}${familyId}`,
    );
    return phrase;
  } catch {
    return null;
  }
}

/**
 * Clear the stored recovery phrase (e.g., on family leave/reset).
 */
export async function clearRecoveryPhrase(): Promise<void> {
  try {
    const familyId = await getFamilyId();
    if (familyId) {
      await (await getSecureStore()).deleteItemAsync(
        `${RECOVERY_PHRASE_ALIAS_PREFIX}${familyId}`,
      );
      await (await getSecureStore()).deleteItemAsync(
        `${RECOVERY_STORED_FLAG_PREFIX}${familyId}`,
      );
      await (await getSecureStore()).deleteItemAsync(
        `${RECOVERY_SEED_ALIAS_PREFIX}${familyId}`,
      );
    }
  } catch {
    // Ignore errors during cleanup
  }
}