"""
Ticker symbol detection from natural language assistant queries.

Extracts US equity ticker symbols from free-text user messages so the assistant
can pre-fetch live market context before calling Claude. Handles:
  - Explicit dollar-sign tickers:  "$MRVL", "$AAPL", "$mrvl"
  - Bare tickers in any case:      "MRVL", "mrvl", "Nvda is up today"

Design notes:
* The blocklist covers common English words, finance abbreviations, and
  STOCVEST-internal terms. It must be comprehensive enough to avoid false
  positives when the full input is uppercased before matching (the only way
  to reliably catch tickers typed in lowercase).
* Only the LAST detected ticker in the message is returned.
* Symbols are capped at 5 characters (NYSE/NASDAQ max for equities).
"""

from __future__ import annotations

import re

# Words that look like tickers but are not. Applied after uppercasing the
# full input, so must include common English words in their uppercase form.
_BLOCKLIST: frozenset[str] = frozenset({
    # ── Articles / pronouns / prepositions ──────────────────────────────────
    "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "HE",
    "IF", "IN", "IS", "IT", "ME", "MY", "NO", "OF", "OK", "ON", "OR",
    "SO", "TO", "UP", "US", "WE", "HI",

    # ── Common 3-letter English words ───────────────────────────────────────
    "ACT", "AGO", "AID", "AIM", "AIR", "ARC", "ARE", "ARK",
    "ASH", "ATE", "AWE", "AXE", "AYE",
    "BAD", "BAN", "BAR", "BAT", "BED", "BEG", "BIT", "BOX", "BOY",
    "BUT", "BUY",
    "CAB", "CAN", "CAP", "CAR", "CAT", "COP", "COT", "COW", "CRY",
    "CUB", "CUP", "CUT",
    "DAM", "DID", "DIG", "DIM", "DIP", "DOG", "DRY", "DUE", "DUG",
    "EAR", "EAT", "EEL", "EGG", "ELM", "ERR", "EVE", "EWE",
    "FAD", "FAN", "FAR", "FAT", "FIG", "FIT", "FLY", "FOG", "FOR",
    "FOX", "FRY", "FUN",
    "GAP", "GAS", "GEM", "GET", "GIN", "GOD", "GOT", "GUM", "GUY",
    "HAD", "HAS", "HAT", "HEN", "HEY", "HIM", "HIS", "HIT", "HOG",
    "HOP", "HOT", "HOW", "HUG", "HUM", "HUT",
    "ICE", "ILL", "INK", "INN",
    "JAB", "JAM", "JAR", "JAW", "JET", "JOB", "JOG", "JOT", "JOY",
    "JUG",
    "KID", "KIT",
    "LAB", "LAD", "LAG", "LAP", "LAW", "LAX", "LAY", "LED", "LEG",
    "LET", "LID", "LIE", "LIT", "LOG", "LOT", "LOW",
    "MAD", "MAN", "MAP", "MAR", "MAT", "MAY", "MIX", "MOB", "MOP",
    "MOW", "MUD", "MUG",
    "NAG", "NAP", "NAY", "NET", "NEW", "NIT", "NOD", "NOR", "NOT",
    "NOW", "NUB", "NUN", "NUT",
    "OAF", "OAK", "OAR", "OAT", "ODD", "ODE", "OFT", "OIL", "OLD",
    "ONE", "OPT", "ORB", "ORE", "OUR", "OUT", "OWE", "OWL", "OWN",
    "PAD", "PAN", "PAP", "PAR", "PAT", "PAW", "PAY", "PEA", "PEG",
    "PEP", "PEW", "PIE", "PIG", "PIN", "PIT", "POD", "POP", "POT",
    "POW", "PRY", "PUB", "PUG", "PUN", "PUP", "PUT",
    "RAG", "RAN", "RAP", "RAT", "RAW", "RAY", "RID", "RIG", "RIM",
    "RIP", "ROB", "ROD", "ROE", "ROT", "ROW", "RUB", "RUG", "RUM",
    "RUN", "RUT",
    "SAC", "SAG", "SAP", "SAT", "SAW", "SAY", "SEA", "SEE", "SET", "SEW",
    "SHE", "SHY", "SIN", "SIP", "SIT", "SKI", "SKY", "SLY", "SOB",
    "SOD", "SOT", "SOW", "SOY", "SPA", "SPY", "STY", "SUB", "SUM",
    "SUN", "SUP",
    "TAB", "TAD", "TAN", "TAP", "TAR", "TAX", "TEN", "TIE", "TIN",
    "TIP", "TOE", "TOG", "TOM", "TOP", "TOT", "TOW", "TOY", "TUB",
    "TUG", "TUN", "TUT", "TWO",
    "UGH", "UMP", "URN", "USE",
    "VAT", "VIA", "VIE", "VOW",
    "WAD", "WAG", "WAR", "WAX", "WAY", "WED", "WEE", "WEN", "WET",
    "WHO", "WIG", "WIT", "WOE", "WOK", "WON", "WOO", "WOP", "WOW",
    "YAK", "YAM", "YAP", "YAW", "YEA", "YEP", "YEW", "YET", "YOU",
    "ZAP", "ZED", "ZEN", "ZIP", "ZOO",
    # also
    "ALL", "AND", "ANY", "ARE", "ASK", "ITS", "THE", "WHY", "WIN", "YES",
    "ADD", "AGE", "BIG", "CRY", "DAY", "END", "FAR", "FEW", "GAS",
    "LET", "RUN", "SIX", "TRY", "USE",

    # ── Common 4-letter English words ───────────────────────────────────────
    "ABLE", "ALSO", "AREA", "ARMY", "AWAY", "BACK", "BALL", "BAND",
    "BASE", "BATH", "BEEN", "BELL", "BELT", "BEST", "BIRD", "BITE",
    "BLOW", "BLUE", "BOAT", "BODY", "BOLD", "BOMB", "BONE", "BOOK",
    "BOOM", "BOOT", "BORN", "BOTH", "BUCK", "BULK", "BUMP", "BURN",
    "CAME", "CARE", "CART", "CASE", "CAVE", "CHIP", "CITY", "CLAD",
    "CLAN", "CLAY", "CLUB", "COAL", "COAT", "COIN", "COLD", "COME",
    "COOK", "COOL", "COPE", "COPY", "CORD", "CORN", "COST", "COUP",
    "CREW", "CROP", "CYAN",
    "DARK", "DART", "DATA", "DATE", "DAWN", "DAYS", "DEAD", "DEAL",
    "DEAN", "DEAR", "DECK", "DEED", "DEEP", "DENY", "DESK", "DIME",
    "DIRT", "DISH", "DISK", "DOCK", "DOES", "DOME", "DONE", "DOOR",
    "DOSE", "DOVE", "DOWN", "DRAG", "DRAW", "DRIP", "DROP", "DRUM",
    "DUAL", "DUKE", "DULL", "DUMB", "DUMP", "DUSK", "DUST", "DUTY",
    "EACH", "EARN", "EASE", "EAST", "EDGE", "ELSE", "EPIC", "EVEN",
    "EVER", "EVIL", "EXAM",
    "FACE", "FACT", "FAIL", "FAIR", "FAKE", "FALL", "FAME", "FAST",
    "FATE", "FEAT", "FEEL", "FELL", "FELT", "FILE", "FILL", "FILM",
    "FIND", "FINE", "FIRE", "FIVE", "FLAG", "FLAT", "FLAW", "FLEW",
    "FLIP", "FLOW", "FOAM", "FOLD", "FOLK", "FOND", "FONT", "FOOD",
    "FOOL", "FOOT", "FORE", "FORM", "FORT", "FOUL", "FOUR", "FREE",
    "FROM", "FUEL", "FULL", "FUND",
    "GAIN", "GAME", "GANG", "GAVE", "GEAR", "GENE", "GIFT", "GIVE",
    "GLAD", "GLOB", "GLUE", "GOAL", "GOES", "GONE", "GOOD", "GORE",
    "GRAB", "GRAY", "GREW", "GREY", "GRID", "GRIP", "GRIT", "GROW",
    "GULF", "GUST",
    "HACK", "HAIL", "HALF", "HALL", "HAND", "HANG", "HARD", "HARM",
    "HATE", "HAVE", "HEAD", "HEAL", "HEAP", "HEAR", "HEAT", "HEEL",
    "HELD", "HELL", "HELP", "HERE", "HIDE", "HIGH", "HILL", "HINT",
    "HIRE", "HOLD", "HOLE", "HOLY", "HOME", "HOOK", "HOPE", "HORN",
    "HOST", "HOUR", "HUGE", "HULL", "HUNT", "HURT",
    "IDEA", "IDLE", "INCH", "INFO",
    "JOIN", "JOKE", "JUMP", "JUST",
    "KEEN", "KEEP", "KILL", "KIND", "KING", "KNEW", "KNOW",
    "LACE", "LACK", "LAID", "LAKE", "LAND", "LANE", "LAST", "LATE",
    "LEAD", "LEAF", "LEAN", "LEAP", "LEFT", "LEND", "LESS", "LIFT",
    "LIKE", "LIME", "LINE", "LINK", "LIST", "LIVE", "LOAD", "LOAN",
    "LOCK", "LOGO", "LONG", "LOOK", "LOOP", "LORE", "LOSE", "LOSS",
    "LOST", "LOTS", "LOUD", "LOVE",
    "MADE", "MAIN", "MAKE", "MALE", "MALL", "MANY", "MARK", "MASK",
    "MASS", "MEAL", "MEAN", "MEAT", "MEET", "MENU", "MESH", "MESS",
    "MILD", "MILE", "MILK", "MILL", "MIND", "MINE", "MISS", "MODE",
    "MOOD", "MORE", "MOST", "MOVE", "MUCH", "MUST",
    "NAIL", "NAME", "NAVY", "NEAR", "NEED", "NEWS", "NEXT", "NICE",
    "NINE", "NODE", "NONE", "NORM", "NOTE",
    "ONCE", "ONLY", "OPEN", "ORAL", "OVER",
    "PACE", "PACK", "PAGE", "PAID", "PAIR", "PARK", "PART", "PASS",
    "PAST", "PATH", "PEAK", "PILE", "PICK", "PIPE", "PLAN", "PLOT",
    "PLUG", "PLUS", "POEM", "POLE", "POLL", "POND", "POOL", "POPE",
    "PORE", "PORT", "POSE", "POST", "POUR", "PREY", "PULL", "PUSH",
    "QUAD", "QUIT",
    "RACE", "RACK", "RANK", "RARE", "RATE", "READ", "REAL", "REEL",
    "RELY", "RENT", "REST", "RICE", "RICH", "RIDE", "RING", "RISE",
    "RISK", "ROAD", "ROCK", "ROLE", "ROLL", "ROOF", "ROOM", "ROOT",
    "ROPE", "ROSE", "RUIN", "RULE",
    "SAFE", "SAID", "SAIL", "SALE", "SALT", "SAND", "SANG", "SAME",
    "SAVE", "SEAL", "SEED", "SEEK", "SEEN", "SEES", "SELF", "SELL", "SEND",
    "SHIP", "SHOP", "SHOT", "SHOW", "SHUT", "SICK", "SIDE", "SIGN",
    "SILK", "SIZE", "SKIN", "SKIP", "SLAM", "SLIP", "SLOW", "SLUG",
    "SNAP", "SNOW", "SOIL", "SOLD", "SOLE", "SOME", "SONG", "SOON",
    "SORT", "SOUL", "SOUP", "SPAN", "SPIN", "SPOT", "STAB", "STAG",
    "STAR", "STAY", "STEM", "STEP", "STIR", "STOP", "STUB", "SUCH",
    "SUIT", "SUNG", "SUNK", "SWAP", "SWIM",
    "TAIL", "TALE", "TALK", "TALL", "TASK", "TEAM", "TEAR", "TELL",
    "TEST", "TEXT", "THAN", "THAT", "THEM", "THEN", "THEY", "THIN",
    "THIS", "TILT", "TIME", "TINY", "TIRE", "TOAD", "TOLD", "TOLL",
    "TOMB", "TONE", "TOOK", "TOOL", "TORN", "TOWN", "TRAP", "TREE",
    "TRIM", "TRIP", "TRUE", "TUBE", "TUNE", "TURN", "TWIN", "TYPE",
    "UGLY", "UNIT", "UPON",
    "VAST", "VERY", "VIEW", "VISA", "VOID", "VOTE",
    "WAGE", "WAIT", "WAKE", "WALK", "WALL", "WANT", "WARD", "WARM",
    "WARN", "WARY", "WEAR", "WEED", "WEEK", "WELL", "WENT", "WERE",
    "WHEN", "WIDE", "WILD", "WILL", "WILT", "WIND", "WINE", "WING",
    "WIRE", "WISE", "WISH", "WITH", "WOKE", "WOLF", "WOOD", "WORD",
    "WORE", "WORM", "WORN", "WOVE", "WRAP",
    "WHAT", "WHEN", "WITH", "WORD", "WORK", "WORE", "WORN",
    "YARD", "YEAR", "YOUR",
    "ZEAL", "ZERO", "ZONE",

    # ── Common 5-letter English words ───────────────────────────────────────
    "ABOUT", "ABOVE", "ADDED", "AFTER", "AGAIN", "AHEAD", "AIMED",
    "ALERT", "ALIGN", "ALIVE", "ALLAY", "ALOFT", "ALONE", "ALONG",
    "ALTER", "AMONG", "APPLY", "ARISE", "ASKED", "ASSET",
    "AWAIT", "AWARD", "AWARE",
    "BADLY", "BASIC", "BEACH", "BEGAN", "BEGIN", "BEING", "BELOW",
    "BLACK", "BLAME", "BLAND", "BLANK", "BLAST", "BLEND", "BLIND",
    "BLOCK", "BLOOD", "BLOWN", "BOARD", "BOOST", "BOUND", "BRAIN",
    "BRAND", "BRAVE", "BREAK", "BRIDE", "BRIEF", "BRING", "BROAD",
    "BROKE", "BUILT", "BUNCH", "BURST",
    "CARRY", "CATCH", "CAUSE", "CHAIN", "CHAIR", "CHALK", "CHEAP",
    "CHECK", "CHEST", "CHIEF", "CHILD", "CHOSE", "CIVIC", "CIVIL",
    "CLAIM", "CLASS", "CLEAN", "CLEAR", "CLIMB", "CLOCK", "CLOSE",
    "CLOUD", "COACH", "COAST", "COMIC", "COULD", "COUNT", "COURT",
    "COVER", "CRACK", "CRAFT", "CRASH", "CRAZY", "CREAM", "CROSS",
    "CROWD", "CRUSH", "CURVE",
    "DAILY", "DANCE", "DATED", "DEBUT", "DEPTH", "DIRTY", "DOING",
    "DOUBT", "DRAFT", "DRAIN", "DRAWN", "DREAM", "DRESS", "DRIFT",
    "DRINK", "DRIVE", "DROVE", "DYING",
    "EAGER", "EARLY", "EIGHT", "ENTER", "ERROR", "EQUAL", "ESSAY",
    "EVENT", "EVERY", "EXACT", "EXIST",
    "FAINT", "FAITH", "FALSE", "FANCY", "FATAL", "FAULT", "FEAST",
    "FENCE", "FEVER", "FIELD", "FIFTH", "FIFTY", "FIGHT", "FINAL",
    "FIRST", "FIXED", "FLAME", "FLESH", "FLOAT", "FLOOD", "FLOOR",
    "FLUID", "FLUSH", "FOCUS", "FORCE", "FORGE", "FORTH", "FORUM",
    "FOUND", "FRAME", "FRANK", "FRAUD", "FRESH", "FRONT", "FROST",
    "FRUIT", "FULLY",
    "GIANT", "GIVEN", "GLEAM", "GLOAT", "GLOBE", "GOING", "GRACE",
    "GRADE", "GRAIN", "GRAND", "GRANT", "GRASP", "GRASS", "GREAT",
    "GREEN", "GREET", "GRIEF", "GRIND", "GROAN", "GROUP", "GROWN",
    "GUARD", "GUESS", "GUEST", "GUIDE", "GUILT", "GUISE",
    "HABIT", "HAPPY", "HARSH", "HAUNT", "HEADS", "HEARD", "HEART",
    "HEAVY", "HENCE", "HILLS", "HOIST", "HONEY", "HONOR", "HOUSE",
    "HUMAN", "HUMOR",
    "IDEAL", "IMAGE", "IMPLY", "INDEX", "INNER", "INPUT", "ISSUE",
    "JUDGE", "JUICE", "KINDS", "KNOWN",
    "LABEL", "LANCE", "LARGE", "LATER", "LAUGH", "LAYER", "LEARN",
    "LEAST", "LEAVE", "LEGAL", "LEVEL", "LIGHT", "LIMIT", "LINKS",
    "LIVER", "LOCAL", "LOGIC", "LOOSE", "LOWER", "LUCKY", "LUNAR",
    "MAGIC", "MAJOR", "MAKER", "MARCH", "MATCH", "MAYOR", "MEANS",
    "MEDIA", "MERIT", "METAL", "MIGHT", "MINOR", "MINUS", "MIXED",
    "MODEL", "MONEY", "MONTH", "MORAL", "MOUNT", "MOUTH", "MOVED",
    "MOVES", "MOVIE", "MUSIC",
    "NIGHT", "NOBLE", "NOISE", "NORTH", "NOVEL",
    "OCCUR", "OFFER", "OFTEN", "ORDER", "OTHER", "OUGHT", "OUTER",
    "OWNED",
    "PANEL", "PAPER", "PARTY", "PEACE", "PHASE", "PHONE", "PHOTO",
    "PIECE", "PILOT", "PIXEL", "PLACE", "PLAIN", "PLANE", "PLANT",
    "PLATE", "PLAZA", "POINT", "POWER", "PRESS", "PRICE", "PRIDE",
    "PRIME", "PRIOR", "PRIZE", "PROBE", "PROOF", "PROSE", "PROUD",
    "PROVE", "PROXY",
    "QUEEN", "QUERY", "QUEUE", "QUICK", "QUIET", "QUOTA", "QUOTE",
    "RAISE", "RANGE", "RAPID", "RATIO", "REACH", "READY", "REALM",
    "REFER", "REIGN", "RELAX", "REPLY", "RIDER", "RIGHT", "RIGID",
    "RIVAL", "RIVER", "ROBOT", "ROCKS", "ROUGH", "ROUND", "ROUTE",
    "ROYAL", "RURAL",
    "SCALE", "SCENE", "SCOPE", "SCORE", "SCOUT", "SENSE", "SEVEN",
    "SHAPE", "SHARE", "SHARP", "SHIFT", "SHIRT", "SHORT", "SIGHT",
    "SKILL", "SLASH", "SLICE", "SLIDE", "SMALL", "SMART", "SMILE",
    "SMOKE", "SOLID", "SOLVE", "SORRY", "SOUND", "SOUTH", "SPACE",
    "SPARE", "SPARK", "SPEAK", "SPEND", "SPLIT", "SPOKE", "SPORT",
    "SPRAY", "SQUAD", "STACK", "STAFF", "STAGE", "STAKE", "STAND",
    "START", "STATE", "STEEL", "STICK", "STILL", "STOCK", "STONE",
    "STOOD", "STORE", "STORM", "STORY", "STRAP", "STRIP", "STUCK",
    "STUDY", "STYLE", "SUGAR", "SUITE", "SUPER", "SURGE", "SWEAR",
    "SWEEP", "SWEET", "SWIFT", "SWING",
    "TABLE", "TASTE", "THANK", "THEME", "THERE", "THESE", "THICK",
    "THING", "THINK", "THIRD", "THOSE", "THREE", "THREW", "THROW",
    "THUMB", "TIGHT", "TIMER", "TIRED", "TITLE", "TODAY", "TOKEN",
    "TOTAL", "TOUCH", "TOUGH", "TOWER", "TRACE", "TRACK", "TRADE",
    "TRAIL", "TRAIN", "TRAIT", "TREND", "TRIAL", "TRIBE", "TRICK",
    "TRIED", "TRULY", "TRUMP", "TRUNK", "TRUST", "TRUTH", "TUMOR",
    "TWIST",
    "SETUP", "ULTRA", "UNDER", "UNFIT", "UNION", "UNTIL", "UPPER", "UPSET",
    "USAGE", "USING", "USUAL",
    "VAGUE", "VALID", "VALUE", "VALVE", "VERSE", "VIDEO", "VIGOR",
    "VIRAL", "VISIT", "VITAL", "VOICE",
    "WASTE", "WATCH", "WATER", "WEIGH", "WEIRD", "WHALE", "WHERE",
    "WHICH", "WHILE", "WHITE", "WHOSE", "WHOLE", "YIELD", "YOUNG",
    "YOURS", "YOUTH",

    # ── Finance abbreviations / STOCVEST terms that are NOT tickers ─────────
    "AI", "API", "APR", "APY", "ATH", "ATM", "ATR", "AUM",
    "BB", "BPS", "BTC", "CB",
    "CD", "CEO", "CFO", "COO", "CPO", "CTO", "CPI",
    "DCF", "DD", "DIV", "DJ", "DMA", "DXY",
    "E", "ECB", "EMA", "EPS", "ETF", "ETH", "EV",
    "FD", "FED", "FF", "FOMC", "FSR", "FX",
    "G", "G7", "G20", "GDP", "GTC",
    "HFT", "HOD",
    "ICO", "IMF", "IPO", "IRA", "IRR", "ISM", "IV", "IVP",
    "KPI", "LOD", "LOI",
    "M", "M1", "M2", "MA", "MBS", "MM",
    "NAV", "NFP", "NLP",
    "OP", "OTC", "OTM", "ORB",
    "P", "PB", "PC", "PDT", "PE", "PEG", "PM", "PNL",
    "QE",
    "R", "RBA", "ROA", "ROE", "ROI", "RSI", "RV",
    "S", "SEC", "SMA", "SOX", "SP",
    "T", "TA", "TF", "TV",
    "UK", "USD", "UI", "UX",
    "V", "VWAP", "VIX", "VOL", "VP",
    "WIM", "X", "YTD",
    # Country / region codes
    "EU", "ECB", "FRB",
})

# Matches $TICKER (case-insensitive on the uppercased input).
_DOLLAR_PATTERN = re.compile(r"\$([A-Z]{1,5})\b")
# Matches 2–5 uppercase letters as a whole word.
_BARE_PATTERN = re.compile(r"\b([A-Z]{2,5})\b")


def detect_symbol(text: str) -> str | None:
    """Return the most-likely ticker from *text*, or None if none found.

    Priority order:
    1. Dollar-sign tickers — "$mrvl", "$MRVL" (case-insensitive).
    2. Any 2–5 letter word after uppercasing the whole input, filtered by blocklist.
       Uppercasing the input catches tickers typed in lowercase ("mrvl", "nvda").
       The blocklist prevents common English words from being detected.

    Returns the LAST match so "I was watching AAPL but what about NVDA?"
    correctly yields NVDA.
    """
    if not text or not text.strip():
        return None

    upper = text.upper()

    # Phase 1 — explicit dollar-sign ticker (highest confidence).
    dollar_hits = _DOLLAR_PATTERN.findall(upper)
    if dollar_hits:
        return dollar_hits[-1]

    # Phase 2 — any 2–5 letter word on the uppercased input, minus the blocklist.
    bare_hits = [m for m in _BARE_PATTERN.findall(upper) if m not in _BLOCKLIST]
    if bare_hits:
        return bare_hits[-1]

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Explicit watchlist-action ticker extraction
# ─────────────────────────────────────────────────────────────────────────────
# When a user issues an explicit action ("add PE to my watchlist", "remove MRVL"),
# the named token IS the ticker by intent — even when it collides with a
# blocklisted abbreviation (PE, EV, CD, …). The blocklist exists to avoid false
# positives in free-text *questions*; for an explicit action we trust the token
# that directly follows the action verb instead.

_ACTION_VERB_PATTERN = re.compile(
    r"\b(add|watch|track|put|remove|delete|unwatch|drop|stop\s+watching|stop\s+tracking)\b",
    re.IGNORECASE,
)

# Small stoplist of connectors/pronouns that can sit right after an action verb
# but are never tickers ("add IT to my watchlist", "remove the stock").
_ACTION_STOPWORDS: frozenset[str] = frozenset({
    "IT", "TO", "MY", "THE", "A", "AN", "THIS", "THAT", "ME", "ON", "OF",
    "FROM", "STOCK", "STOCKS", "SYMBOL", "TICKER", "SHARE", "SHARES",
    "PLEASE", "CAN", "YOU", "FOR", "AND", "OUT", "OFF", "WATCH", "LIST",
})


def extract_action_symbol(text: str) -> str | None:
    """Extract the ticker named in an explicit add/remove watchlist action.

    Unlike :func:`detect_symbol`, this trusts the token immediately following the
    action verb so blocklisted-but-valid tickers (e.g. ``PE``) are honoured. Falls
    back to :func:`detect_symbol` when no action verb is present or no plausible
    token follows it.

    Examples
    --------
    >>> extract_action_symbol("add PE to my watchlist")
    'PE'
    >>> extract_action_symbol("remove mrvl from my watchlist")
    'MRVL'
    >>> extract_action_symbol("add it to my watchlist")  # -> falls back, None
    """
    if not text or not text.strip():
        return None

    upper = text.upper()
    # Explicit dollar-sign ticker always wins (highest confidence).
    dollar_hits = _DOLLAR_PATTERN.findall(upper)
    if dollar_hits:
        return dollar_hits[-1]

    verb_match = _ACTION_VERB_PATTERN.search(text)
    if verb_match is not None:
        rest = text[verb_match.end():]
        # Whole-word tokens only, so "watchlist" is never partially matched as "watch".
        for tok in re.findall(r"\b[A-Za-z]{1,5}\b", rest):
            up = tok.upper()
            if up in _ACTION_STOPWORDS:
                continue
            if up not in _BLOCKLIST:
                # A clear, non-ambiguous ticker (e.g. MRVL, TSLA, NVDA).
                return up
            # The token collides with a blocklisted abbreviation. Only trust it as
            # a ticker when the user wrote it as a deliberate ticker — all-caps
            # ("add PE") — otherwise it's an English word ("track been doing").
            if tok.isupper() and len(tok) >= 2:
                return up
            # Lowercase blocklisted word — skip and keep scanning.

    # No usable token right after the verb — fall back to the general detector.
    return detect_symbol(text)


# ─────────────────────────────────────────────────────────────────────────────
# Company-name → ticker fallback extraction
# ─────────────────────────────────────────────────────────────────────────────
# When no ticker token is detected but the user clearly asks about a single
# named instrument's state ("how did marvell do today?", "any news on palantir?"),
# we extract a best-effort company-name phrase. The caller MUST confirm it via a
# reference search before fetching data — this extractor is intentionally loose,
# and the search's name-match guard is the real protection against wrong fetches.

# Phrases that signal the user is asking about a specific instrument right now.
_LOOKUP_CUES: tuple[str, ...] = (
    "how is", "how's", "how are", "how did", "how has", "how about",
    "doing", "perform", "trading", "trade", "happening", "activity",
    "moving", "moved", "price of", "quote", "news on", "news about",
    "tell me about", "what about", "going on", "look up", "pull up",
    "update on", "is it up", "is it down", "today", "this morning",
    "right now", "lately", "recently", "rally", "drop", "gap",
    # Forecast / outlook framing — "what's the forecast for broadcom",
    # "outlook on AVGO", "analyst target for X". These ask about one named
    # instrument just as much as "how is X doing", so they must resolve a
    # company name (the reference search still guards against bad matches).
    "forecast", "outlook", "prediction", "predict", "price target",
    "target for", "target on", "expect", "future of", "prospects",
    "analyst", "estimate", "consensus", "what does stocvest think",
    "stocvest think", "fair value", "valuation of",
)

# Verb / time / generic-noun tokens that are never the company name.
_LOOKUP_FILLER: frozenset[str] = frozenset({
    "PERFORM", "PERFORMED", "PERFORMING", "PERFORMS", "DOING", "DONE",
    "TODAY", "TODAYS", "MORNING", "AFTERNOON", "EVENING", "TONIGHT",
    "NOW", "LATELY", "RECENTLY", "CURRENTLY", "TRADING", "TRADED", "TRADE",
    "TRADES", "HAPPENING", "HAPPEN", "HAPPENED", "GOING", "MOVING", "MOVED",
    "MOVE", "MOVES", "PRICE", "PRICED", "QUOTE", "QUOTES", "NEWS", "ACTIVITY",
    "UPDATE", "UPDATES", "UPDATED", "LOOK", "PULL", "TELL", "ABOUT", "GIVE",
    "SHOW", "FIND", "CHECK", "RALLY", "RALLYING", "DROP", "DROPPING",
    "GAP", "GAPPED", "GAPPING", "RISING", "FALLING", "STATUS", "FARED",
    "FARING", "STAND", "STANDING", "LOOKING", "WEEK", "MONTH", "YEAR",
    "STOCK", "STOCKS", "SHARES", "SHARE", "COMPANY", "TICKER", "SYMBOL",
    "RATIO", "EVALUATION", "EVERYTHING", "POSITION", "POSITIONS", "USED",
    "PLEASE", "RAN", "FROM", "MUCH",
    # Forecast / outlook framing — common trailing words that aren't the name.
    "FORECAST", "FORECASTS", "OUTLOOK", "PREDICT", "PREDICTION", "PREDICTIONS",
    "TARGET", "TARGETS", "EXPECT", "EXPECTED", "EXPECTS", "FUTURE", "PROSPECTS",
    "GUIDANCE", "ESTIMATE", "ESTIMATES", "OPINION", "THOUGHTS", "ANALYSIS",
    "ANALYST", "ANALYSTS", "CONSENSUS", "RATING", "RATINGS",
    "COMING", "AHEAD", "SESSION", "CLOSE", "CLOSED", "OPEN", "OPENING",
    "FAIR", "VALUE", "VALUATION", "WORTH",
    # Relative time words that trail a question but are never the company name.
    "YESTERDAY", "YESTERDAYS", "TOMORROW", "TOMORROWS",
    # Framing tokens for "what does STOCVEST think of X" / "what's the … for X".
    "STOCVEST", "THINK", "THINKS", "THINKING", "WHATS", "DOES", "OPINION",
})

# Market-/portfolio-level subjects: their presence means the question is NOT
# about a single company, so we never resolve to a ticker (those go to the
# market-overview / watchlist intents instead).
_MARKET_LEVEL_SUBJECTS: frozenset[str] = frozenset({
    "MARKET", "MARKETS", "ECONOMY", "ECONOMIC", "SECTOR", "SECTORS",
    "INDUSTRY", "PORTFOLIO", "WATCHLIST", "WATCHLISTS", "FUTURES",
    "INDEX", "INDICES", "DOW", "NASDAQ", "NYSE", "CRYPTO", "BITCOIN",
    "ETHEREUM",
})


def extract_company_lookup_phrase(text: str) -> str | None:
    """Return a candidate company-name phrase from a symbol-directed question.

    Used only as a fallback when :func:`detect_symbol` finds no ticker token, so
    questions phrased with a company name ("how did marvell do today?") can still
    resolve to a ticker via a reference search. Returns ``None`` unless the
    message clearly asks about a single named instrument and a clean 1–3 word
    candidate survives the stoplists.

    This is intentionally loose; callers MUST confirm the phrase against a
    reference search (company-name match) before fetching any market data.
    """
    if not text or not text.strip():
        return None
    low = text.lower()
    if not any(cue in low for cue in _LOOKUP_CUES):
        return None

    candidate: list[str] = []
    for tok in re.findall(r"[A-Za-z][A-Za-z.&'\-]*", text):
        up = tok.upper().strip(".'&-")
        if len(up) < 2:
            continue
        if up in _MARKET_LEVEL_SUBJECTS:
            # A market-/portfolio-level subject — not a single-company lookup.
            return None
        if up in _BLOCKLIST or up in _LOOKUP_FILLER or up in _ACTION_STOPWORDS:
            continue
        candidate.append(tok)

    if not 1 <= len(candidate) <= 3:
        return None
    phrase = " ".join(candidate).strip()
    return phrase if len(phrase) >= 3 else None


def detect_symbol_from_messages(messages: list[dict]) -> str | None:
    """Scan the most-recent user turns (up to last 3) for a ticker symbol.

    Checks the last user message first; falls back to prior turns so
    follow-ups like "why did it gap up?" can resolve from context.
    """
    if not isinstance(messages, list):
        return None

    user_texts = [
        str(m.get("content") or "")
        for m in reversed(messages)
        if isinstance(m, dict) and m.get("role") == "user"
    ][:3]

    for text in user_texts:
        sym = detect_symbol(text)
        if sym:
            return sym

    return None


def detect_company_phrase_from_messages(messages: list[dict]) -> str | None:
    """Scan recent prior user turns for a company-name lookup phrase.

    Mirrors :func:`detect_symbol_from_messages` but for company NAMES, so a
    pronoun follow-up ("how do you see it will perform today?") can inherit the
    subject named a turn earlier ("how did broadcom do yesterday?") instead of
    falling through to the page's loaded symbol. The caller MUST still confirm
    the phrase via a reference search before fetching data.
    """
    if not isinstance(messages, list):
        return None

    user_texts = [
        str(m.get("content") or "")
        for m in reversed(messages)
        if isinstance(m, dict) and m.get("role") == "user"
    ][:3]

    for text in user_texts:
        phrase = extract_company_lookup_phrase(text)
        if phrase:
            return phrase

    return None
