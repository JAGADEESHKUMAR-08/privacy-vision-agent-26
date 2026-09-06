"""
Synthetic PII Training Data Generator.

Generates realistic but completely fictional PII training data for a
PII type classifier. All data is synthetic and fictional - no real
personal information is used.

Categories:
    EMAIL, PHONE, CREDIT_CARD, NAME, ADDRESS, PASSWORD, USERNAME,
    API_KEY, AUTH_TOKEN, SSN, MEDICAL_ID, BANK_ACCOUNT, FINANCIAL_DATA,
    DATE_OF_BIRTH, NONE

Outputs:
    pii_training_data.json   - full dataset
    pii_train.json           - 80% split
    pii_val.json             - 10% split
    pii_test.json            - 10% split
"""

import json
import os
import random

random.seed(20260906)

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Synthetic value generators (no real data, all fictional)
# ---------------------------------------------------------------------------

NAME_FIRST = [
    "Aarav", "Isabella", "Liam", "Sofia", "Noah", "Aisha", "Mateo", "Yuki",
    "Ethan", "Priya", "Lucas", "Mei", "Oliver", "Zainab", "Julian", "Hana",
    "Mason", "Amara", "Elijah", "Leila", "Omar", "Anya", "Gabriel", "Fatima",
    "Lucas", "Elena", "James", "Ravi", "Benjamin", "Sana", "Henry", "Mia",
    "Daniel", "Eva", "Adam", "Nadia", "Samuel", "Aria", "Jacob", "Ines",
    "Mohammed", "Lily", "Leo", "Chloe", "Diego", "Grace", "Ali", "Camila",
    "David", "Zara", "Andre", "Isla", "Sergio", "Nora", "Alex", "Rose",
    "Mario", "Tara", "Nikhil", "Vivian", "Hassan", "Karina", "Raj", "Anika",
    "Tom", "Maya", "Kenji", "Lena", "Marco", "Olivia", "Peter", "Dara",
    "Niko", "Rosa", "Theo", "Sana", "Ibrahim", "Layla", "Oscar", "Nina",
]

NAME_LAST = [
    "Patel", "Garcia", "Nguyen", "Smith", "Kim", "Brooks", "Chen", "Martinez",
    "Wilson", "Sharma", "Johnson", "Singh", "Brown", "Rodriguez", "Williams",
    "Khan", "Taylor", "Wu", "Anderson", "Silva", "Lee", "Thomas", "Moore",
    "Jackson", "Martin", "White", "Thompson", "Garcia", "Martinez", "Robinson",
    "Clark", "Rodriguez", "Lewis", "Walker", "Hall", "Young", "Allen", "King",
    "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams",
    "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter",
    "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker",
    "Cruz", "Edwards", "Collins", "Reyes", "Stewart", "Morris", "Morales",
    "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper",
]

NAME_MIDDLE = [
    "A.", "J.", "C.", "M.", "R.", "D.", "K.", "T.", "S.", "L.", "V.", "N.",
    "", "", "", "", "", "", "", "",
]

SYNTHETIC_DOMAINS = [
    "mailbox.com", "quickpost.net", "inboxhaven.org", "messageway.com",
    "orbyte.io", "letterdash.net", "postboxhub.com", "emailcraft.org",
    "sendstream.net", "inboxflare.com", "maildrop.net", "hubmail.org",
    "courierwave.com", "notevault.io", "dispatchlab.net", "replyzone.com",
    "postparcel.org", "mailharbor.net", "vervecourier.com", "sendgridfake.net",
    "notenest.org", "staticmail.com", "whispermail.net", "correspond.io",
    "envelopehub.com", "inboxloop.net", "mailstreampro.com", "firstpost.org",
    "digitalinkmail.net", "postcardwave.com", "searchlite.net", "quicknorth.net",
    "cloudletters.com", "webmailerpro.io", "fastnote.org", "relayfield.net",
    "inboxpeak.com", "letterway.org", "mailorbit.net", "dispatchhub.com",
    "postwise.io", "notesmith.net", "mailoasis.com", "envelopecraft.org",
    "sendline.net", "inboxode.com", "courierdash.org", "postcodes.io",
    "mailvoyage.com", "letterloop.net",
]

FIRST_NAMES_LOWER = [n.lower() for n in NAME_FIRST]
LAST_NAMES_LOWER = [n.lower() for n in NAME_LAST]


def gen_email():
    style = random.randint(0, 4)
    first = random.choice(FIRST_NAMES_LOWER)
    last = random.choice(LAST_NAMES_LOWER)
    domain = random.choice(SYNTHETIC_DOMAINS)
    num = str(random.randint(1, 99))
    if style == 0:
        return f"{first}.{last}@{domain}"
    elif style == 1:
        return f"{first}{num}@{domain}"
    elif style == 2:
        return f"{first}_{last}{num}@{domain}"
    elif style == 3:
        return f"{first[0]}{last}@{domain}"
    else:
        return f"{first}{last[0]}{num}@{domain}"


def gen_phone():
    style = random.randint(0, 5)
    area = str(random.randint(200, 999))
    exch = str(random.randint(200, 999))
    sub = str(random.randint(1000, 9999))
    if style == 0:
        return f"+1 ({area}) {exch}-{sub}"
    elif style == 1:
        return f"({area}) {exch}-{sub}"
    elif style == 2:
        return f"{area}-{exch}-{sub}"
    elif style == 3:
        return f"+1{area}{exch}{sub}"
    elif style == 4:
        return f"{area}.{exch}.{sub}"
    else:
        return f"{area} {exch} {sub}"


def _gen_digits(length):
    return "".join(str(random.randint(0, 9)) for _ in range(length))


def _luhn_checksum(number):
    digits = [int(d) for d in str(number)]
    digits.reverse()
    total = 0
    for i, d in enumerate(digits):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - (total % 10)) % 10


def _valid_luhn(prefix, length):
    while True:
        body = prefix + _gen_digits(length - len(prefix) - 1)
        check = _luhn_checksum(body)
        yield body + str(check)


CARD_BINS = [
    "4532", "4556", "4916", "4920",  # Visa
    "5111", "5169", "5220", "5429",  # Mastercard
    "3714", "3787",  # Amex
    "6011", "6509",  # Discover
]


def gen_credit_card():
    bin_ = random.choice(CARD_BINS)
    length = 16 if bin_ not in ("3714", "3787") else 15
    gen = _valid_luhn(bin_, length)
    number = next(gen)
    style = random.randint(0, 3)
    if style == 0:
        return number
    elif style == 1:
        return " ".join(number[i:i+4] for i in range(0, len(number), 4))
    elif style == 2:
        return "-".join(number[i:i+4] for i in range(0, len(number), 4))
    else:
        return f"{number[i:i+4]} {number[4:8]} {number[8:12]} {number[12:]}" \
            if False else " ".join(number[i:i+4] for i in range(0, len(number), 4))


def gen_name():
    style = random.randint(0, 3)
    first = random.choice(NAME_FIRST)
    last = random.choice(NAME_LAST)
    middle = random.choice(NAME_MIDDLE)
    if style == 0:
        return f"{first} {last}"
    elif style == 1:
        return f"{first} {middle} {last}"
    elif style == 2:
        return f"{last}, {first}"
    else:
        return f"{first} {last}"


STREET_NAMES = [
    "Maple", "Oak", "Cedar", "Pine", "Elm", "Willow", "Birch", "Juniper",
    "Hemlock", "Aspen", "Cherry", "Ash", "Jasmine", "Laurel", "Magnolia",
    "Rosewood", "Sycamore", "Walnut", "Ivy", "Alder", "Briar", "Clover",
    "Dove", "Falcon", "Harbor", "Iris", "Kestrel", "Lark", "Meadow",
    "Nova", "Orchard", "Poppy", "Quail", "River", "Sage", "Thistle",
    "Umber", "Vale", "Willow", "Xeriscape", "Yarrow", "Zephyr",
]

STREET_TYPES = ["St", "Ave", "Rd", "Blvd", "Ln", "Dr", "Ct", "Pl", "Way", "Ter"]

CITIES = [
    "Springfield", "Riverside", "Fairview", "Brookhaven", "Lakewood",
    "Cedarville", "Maplewood", "Ashton", "Greenville", "Northgate",
    "Silverton", "Eastbrook", "Stonebridge", "Westgate", "Hillcrest",
    "Meadowbrook", "Whitfield", "Oakmont", "Peachtree", "Crestview",
    "Riverdale", "Bayshore", "Sunset", "Highland", "Lakeside",
]

STATE_ZIPS = {
    "CA": ["93801", "94304", "94102", "95213", "96022"],
    "NY": ["10451", "11201", "11419", "12309", "14105"],
    "TX": ["75751", "76832", "77422", "78565", "79901"],
    "FL": ["32011", "33122", "33563", "34119", "34951"],
    "WA": ["98001", "98101", "98362", "98501", "98802"],
    "IL": ["60007", "60411", "60616", "61761", "62801"],
    "CO": ["80014", "80202", "80401", "81003", "81520"],
    "GA": ["30021", "30214", "30305", "31023", "31522"],
    "AZ": ["85001", "85251", "85701", "86301", "86504"],
    "MA": ["01020", "02114", "02301", "02631", "02740"],
}


def gen_address():
    num = random.randint(1, 9999)
    street = random.choice(STREET_NAMES)
    stype = random.choice(STREET_TYPES)
    city = random.choice(CITIES)
    state = random.choice(list(STATE_ZIPS.keys()))
    zip_ = random.choice(STATE_ZIPS[state])
    style = random.randint(0, 3)
    if style == 0:
        return f"{num} {street} {stype}, {city}, {state} {zip_}"
    elif style == 1:
        return f"{num} {street} {stype} {city} {state} {zip_}"
    elif style == 2:
        return f"{city}, {state} {zip_}"
    else:
        return f"{num} {street} {stype}"


PASSWORD_WORDS = [
    "sunset", "falcon", "ranger", "autumn", "breeze", "crystal", "dragon",
    "ember", "forest", "golden", "harbor", "island", "jungle", "knight",
    "latitude", "mahogany", "nebula", "ocean", "phoenix", "quartz",
    "raven", "summit", "thunder", "umbrella", "velocity", "willow",
    "xylophone", "yonder", "zephyr", "apple", "banana", "cherry",
]

PASSWORD_SYMBOLS = ["!", "@", "#", "$", "%", "&", "*", "?", "!@", "#$", "%&", "*?"]


def gen_password():
    style = random.randint(0, 4)
    word = random.choice(PASSWORD_WORDS)
    word2 = random.choice(PASSWORD_WORDS)
    num = random.randint(1, 999)
    sym = random.choice(PASSWORD_SYMBOLS)
    if style == 0:
        return f"{word}{num}{sym}".title()
    elif style == 1:
        return f"{word}{sym}{num}"
    elif style == 2:
        return f"{word.capitalize()}{word2.capitalize()}{num}"
    elif style == 3:
        return f"{word}{num}"
    else:
        return f"p@ss_{word}_{num}"


USERNAME_PREFIX = [
    "user", "dev", "pro", "cool", "super", "mega", "tech", "giga", "neo",
    "cyber", "astro", "quantum", "rapid", "swift", "zen", "alpha", "nova",
    "volt", "nova", "flux",
]


def gen_username():
    style = random.randint(0, 4)
    first = random.choice(FIRST_NAMES_LOWER)
    last = random.choice(LAST_NAMES_LOWER)
    num = random.randint(1, 9999)
    prefix = random.choice(USERNAME_PREFIX)
    if style == 0:
        return f"{first}.{last}{num}"
    elif style == 1:
        return f"{prefix}{num}"
    elif style == 2:
        return f"_{first}_{num}"
    elif style == 3:
        return f"{first}{last}{num}"
    else:
        return f"{prefix}_{first}"


def gen_api_key():
    style = random.randint(0, 4)
    if style == 0:
        return f"sk-{_gen_digits(32)}"
    elif style == 1:
        return f"sk_{_gen_digits(24)}"
    elif style == 2:
        prefix = random.choice(["pk", "rk", "ak", "ck", "lk"])
        return f"{prefix}-{_gen_digits(40)}"
    elif style == 3:
        return f"key-{_gen_digits(28)}"
    else:
        return f"sk_live_{_gen_digits(20)}"


def _base64_random_chars(length):
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    return "".join(random.choice(chars) for _ in range(length))


def gen_auth_token():
    style = random.randint(0, 2)
    if style == 0:
        header = _base64_random_chars(random.randint(12, 30))
        payload = _base64_random_chars(random.randint(20, 60))
        sig = _base64_random_chars(random.randint(20, 43))
        return f"{header}.{payload}.{sig}"
    elif style == 1:
        return f"Bearer {_base64_random_chars(40)}"
    else:
        return _base64_random_chars(48)


def gen_ssn():
    style = random.randint(0, 2)
    area = random.randint(1, 899)
    group = random.randint(1, 99)
    serial = random.randint(1, 9999)
    if style == 0:
        return f"{area:03d}-{group:02d}-{serial:04d}"
    elif style == 1:
        return f"{area:03d}{group:02d}{serial:04d}"
    else:
        return f"{area:03d} {group:02d} {serial:04d}"


MEDICAL_PREFIX = [
    "MRN", "PAT", "ACCT", "REC", "ID", "PT",
    "MED", "CHART", "EPI", "HC", "CLIN", "RX",
]


def gen_medical_id():
    style = random.randint(0, 4)
    prefix = random.choice(MEDICAL_PREFIX)
    num = _gen_digits(random.choice([6, 7, 8, 9]))
    if style == 0:
        return f"{prefix}-{num}"
    elif style == 1:
        return f"{prefix}{num}"
    elif style == 2:
        return num
    elif style == 3:
        return f"{prefix}{random.randint(100, 999)}-{_gen_digits(5)}"
    else:
        return f"{prefix.lower()}-{num}"


def gen_bank_account():
    style = random.randint(0, 3)
    account = _gen_digits(random.choice([8, 9, 10, 12]))
    routing = _gen_digits(9)
    if style == 0:
        return f"Account: {account}, Routing: {routing}"
    elif style == 1:
        return account
    elif style == 2:
        return f"{routing}/{account}"
    elif style == 3:
        return f"{account} (routing {routing})"


def gen_financial_data():
    style = random.randint(0, 3)
    amount = random.choice([random.randint(1, 99999), random.randint(1, 999)
                            + random.random()])
    amount_str = f"{amount:.2f}"
    if style == 0:
        return f"${amount_str}"
    elif style == 1:
        return f"${_gen_digits(random.randint(2, 6))}.{_gen_digits(2)}"
    elif style == 2:
        return f"USD {amount_str}"
    else:
        return f"${random.randint(1, 9999)}.{_gen_digits(2)}"


def gen_dob():
    style = random.randint(0, 3)
    year = random.randint(1940, 2010)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    if style == 0:
        return f"{month:02d}/{day:02d}/{year}"
    elif style == 1:
        return f"{year}-{month:02d}-{day:02d}"
    elif style == 2:
        return f"{day:02d}/{month:02d}/{year}"
    else:
        return f"{month:02d}-{day:02d}-{year}"


# ---------------------------------------------------------------------------
# Context sentence templates
# ---------------------------------------------------------------------------

def sentence_around(value):
    templates = [
        "Here is the detail: {v}.",
        "Please confirm your information: {v}",
        "We received the following: {v}",
        "Verify this entry: {v}",
        "The record shows {v}",
        "Update your profile with {v}",
        "Submission value: {v}",
        "The system stored {v}",
        "Details provided: {v}",
        "Your input was {v}",
        "Field input: {v}",
        "Saved value: {v}",
        "Matches found for {v}",
        "Reference: {v}",
        "Attached value: {v}",
        "Processed item: {v}",
        "Entry recorded as {v}",
        "The matching entry is {v}",
        "Retrieved record: {v}",
        "Exact match: {v}",
    ]
    return random.choice(templates).format(v=value)


ACTION_CONTEXTS = [
    "Contact us at {v} for help.",
    "Send a message to {v} now.",
    "Looking up the value {v} in our database.",
    "The profile for {v} was recently updated.",
    "We matched the following: {v}.",
    "Record {v} was found in the system.",
    "Please review the entry: {v}.",
    "A confirmation was sent regarding {v}.",
    "The system flagged {v} for review.",
    "New entry: {v} has been added.",
    "Can you verify {v} for us?",
    "The item {v} is pending approval.",
]


def wrap_context(value, label):
    r = random.random()
    if r < 0.35:
        return value
    elif r < 0.70:
        return sentence_around(value)
    elif r < 0.90:
        # value in middle of sentence
        t = random.choice([
            "Can you confirm {v} is correct?",
            "We need to verify {v} before continuing.",
            "The system recorded {v} at the time of entry.",
            "Please provide {v} to complete the process.",
            "Once {v} is validated, the request proceeds.",
            "An error occurred while processing {v}.",
            "The details for {v} must be double-checked.",
        ])
        return t.format(v=value)
    elif r < 0.97:
        # partial / messy (extra spaces, tabs)
        messy = value.replace(" ", random.choice(["  ", "   ", "\t"]))
        if random.random() < 0.5:
            messy = messy + random.choice([" ", "  ", "  "])
        else:
            messy = random.choice(["  ", " ", "\t"]) + messy
        return messy
    else:
        # near-miss: truncated value
        cut = max(5, len(value) - random.randint(2, 6))
        return value[:cut]


NON_PII_TEMPLATES = [
    "Welcome to our platform",
    "Add to cart",
    "Learn more about our products",
    "Read the full article here",
    "Subscribe to our newsletter",
    "Continue reading",
    "View all results",
    "Filter by category",
    "Sort by price",
    "Show more options",
    "Click here to proceed",
    "This article discusses modern gardening techniques",
    "Product name: Quantum Flux Headphones",
    "Copyright 2026 All Rights Reserved",
    "Terms and conditions apply",
    "Privacy policy available on request",
    "Checkout and payment options",
    "Download the mobile app today",
    "Sign up for a free trial",
    "The weather today is sunny with a high of 75 degrees",
    "Enjoy 20% off your next purchase",
    "Our team worked through the weekend to deliver this feature",
    "The conference will be held in March next year",
    "New firmware update improves battery life significantly",
    "We accept returns within 30 days",
    "Help center and support articles",
    "Browse our best sellers",
    "Featured in leading tech magazines",
    "Award-winning customer service",
    "Fast and free shipping on orders over fifty dollars",
    "Join thousands of happy customers",
    "Settings and preferences",
    "Notification preferences updated",
    "Weekly digest subscription confirmed",
    "Our mission is to simplify access",
    "Team collaboration made easy",
    "Seamless integration with existing tools",
    "Trusted by enterprises worldwide",
    "Secure and reliable infrastructure",
    "Scalable solutions for growing businesses",
    "Built for performance and speed",
    "Take control of your workflow",
    "Automate repetitive tasks effortlessly",
    "Real-time analytics dashboard",
    "Customizable reporting suite",
    "Multi-factor authentication supported",
    "End-to-end encryption built in",
    "Cloud sync across all devices",
    "Backup and restore options",
    "Import data from spreadsheets",
    "Export results in various formats",
]


def gen_none():
    t = random.choice(NON_PII_TEMPLATES)
    if random.random() < 0.5:
        return t
    else:
        return f"{t}."
    if random.random() < 0.1:
        return t.upper()
    return t


# ---------------------------------------------------------------------------
# Per-category sample generation
# ---------------------------------------------------------------------------

def generate_samples_for_category(category, count):
    samples = []
    for n in range(count):
        if category == "EMAIL":
            v = gen_email()
        elif category == "PHONE":
            v = gen_phone()
        elif category == "CREDIT_CARD":
            v = gen_credit_card()
        elif category == "NAME":
            v = gen_name()
        elif category == "ADDRESS":
            v = gen_address()
        elif category == "PASSWORD":
            v = gen_password()
        elif category == "USERNAME":
            v = gen_username()
        elif category == "API_KEY":
            v = gen_api_key()
        elif category == "AUTH_TOKEN":
            v = gen_auth_token()
        elif category == "SSN":
            v = gen_ssn()
        elif category == "MEDICAL_ID":
            v = gen_medical_id()
        elif category == "BANK_ACCOUNT":
            v = gen_bank_account()
        elif category == "FINANCIAL_DATA":
            v = gen_financial_data()
        elif category == "DATE_OF_BIRTH":
            v = gen_dob()
        elif category == "NONE":
            v = gen_none()
        else:
            raise ValueError(f"Unknown category: {category}")

        text = wrap_context(v, category)
        samples.append({"text": text, "label": category})
    return samples


CATEGORIES = [
    "EMAIL", "PHONE", "CREDIT_CARD", "NAME", "ADDRESS", "PASSWORD",
    "USERNAME", "API_KEY", "AUTH_TOKEN", "SSN", "MEDICAL_ID",
    "BANK_ACCOUNT", "FINANCIAL_DATA", "DATE_OF_BIRTH", "NONE",
]


def generate_dataset(samples_per_category=320):
    data = []
    for category in CATEGORIES:
        data.extend(generate_samples_for_category(category, samples_per_category))
    random.shuffle(data)
    return data


# ---------------------------------------------------------------------------
# No-leakage split: group by underlying value so same values don't appear in
# both train and test. We derive a "value key" by stripping context for
# structured categories.
# ---------------------------------------------------------------------------

def extract_value_key(text, label):
    """Heuristic to extract the core value given a category; falls back to text."""
    t = text.strip().lower()
    if label == "NONE":
        return t
    # Try to extract the PII token: for structured categories, we search for
    # known patterns. To keep it robust and still avoid leakage, we pull each
    # whitespace-token / punctuation cluster as potential keys. Simpler approach:
    # use the set of tokens as key so repeated values collide.
    import re
    if label == "EMAIL":
        m = re.search(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", t)
        return m.group(0) if m else t
    if label == "PHONE":
        m = re.search(r"\+?[\d\s().-]{10,}", t)
        return m.group(0) if m else t
    if label == "CREDIT_CARD":
        m = re.search(r"[\d\s-]{15,19}", t)
        return m.group(0).replace(" ", "").replace("-", "") if m else t
    if label == "NAME":
        m = re.search(r"[A-Z][a-z]+(?: [A-Z]?\.? [A-Z][a-z]+)", text)
        return m.group(0) if m else t
    if label == "ADDRESS":
        m = re.search(r"\d+\s+[A-Za-z]+", text)
        return m.group(0) if m else t
    if label == "SSN":
        m = re.search(r"\d{3}-\d{2}-\d{4}", t) or re.search(r"\d{9}", t)
        return m.group(0) if m else t
    if label == "DATE_OF_BIRTH":
        m = re.search(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", t)
        return m.group(0) if m else t
    if label == "MEDICAL_ID":
        m = re.search(r"(?:[A-Za-z]{2,5}-?\d{5,}|(?:mrn|pat|acct|rec|pt|med|chart|hc|clin|rx)-?\d{4,})", t)
        return m.group(0) if m else t
    if label == "BANK_ACCOUNT":
        m = re.search(r"\d{8,12}", t)
        return m.group(0) if m else t
    if label == "FINANCIAL_DATA":
        m = re.search(r"\$\s?\d[\d,]*\.?\d{0,2}|USD\s?\d+", t, re.I)
        return m.group(0) if m else t
    # PASSWORD, USERNAME, API_KEY, AUTH_TOKEN
    return t


def split_no_leak(data, train_frac=0.8, val_frac=0.1):
    """Split maintaining no-value-leakage across splits.

    Samples are grouped by extracted value key; each group is assigned wholly to
    a single split so no duplicate value appears in more than one split.
    """
    from collections import defaultdict

    groups = defaultdict(list)
    for item in data:
        key = extract_value_key(item["text"], item["label"])
        groups[key].append(item)

    # Process groups in a per-split round-robin weighted by target proportions.
    # Randomize order to avoid systematic bias toward a class.
    group_keys = list(groups.keys())
    random.shuffle(group_keys)

    total = len(data)
    target_train = int(total * train_frac)       # ~80%
    target_val = int(total * val_frac)           # ~10%

    train, val, test = [], [], []
    train_count = val_count = 0

    for key in group_keys:
        n = len(groups[key])
        count = train_count + val_count
        remaining = total - count
        if remaining <= 0:
            break

        # Decide target split based on which bucket is currently furthest below
        # its proportional target.
        train_target_now = target_train
        val_target_now = target_val
        test_target_now = total - target_train - target_val

        # Assign to the split that is most "underfilled" proportionally.
        candidates = []
        if train_count / max(train_target_now, 1) <= val_count / max(val_target_now, 1):
            if train_count + n <= train_target_now + 4:
                candidates.append("train")
        if val_count / max(val_target_now, 1) <= train_count / max(train_target_now, 1):
            if val_count + n <= val_target_now + 4:
                candidates.append("val")

        if "train" in candidates:
            train.extend(groups[key])
            train_count += n
        elif "val" in candidates:
            val.extend(groups[key])
            val_count += n
        else:
            test.extend(groups[key])

    random.shuffle(train)
    random.shuffle(val)
    random.shuffle(test)
    return train, val, test


def main():
    samples_per_category = 320  # 15 * 320 = 4800
    data = generate_dataset(samples_per_category=samples_per_category)
    print(f"Generated {len(data)} total samples")

    label_counts = {}
    for item in data:
        label_counts[item["label"]] = label_counts.get(item["label"], 0) + 1
    for label, count in sorted(label_counts.items()):
        print(f"  {label}: {count}")

    train, val, test = split_no_leak(data, train_frac=0.8, val_frac=0.1)

    print(f"\nSplits:")
    print(f"  Train: {len(train)}")
    print(f"  Val:   {len(val)}")
    print(f"  Test:  {len(test)}")

    # Save full dataset
    full_path = os.path.join(OUTPUT_DIR, "pii_training_data.json")
    with open(full_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved full dataset to {full_path}")

    # Save splits
    splits = {
        "pii_train.json": train,
        "pii_val.json": val,
        "pii_test.json": test,
    }
    for fname, split_data in splits.items():
        path = os.path.join(OUTPUT_DIR, fname)
        with open(path, "w") as f:
            json.dump(split_data, f, indent=2)
        print(f"Saved {fname} ({len(split_data)} samples)")

    # Save annotations
    annotations = {
        "samples": data,
        "metadata": {
            "total_samples": len(data),
            "categories": CATEGORIES,
            "splits": {
                "train": len(train),
                "val": len(val),
                "test": len(test),
            },
            "samples_per_category": samples_per_category,
            "generated_at": "2026-09-06",
            "note": "All data is synthetic and fictional. No real PII used.",
        },
    }
    ann_path = os.path.join(OUTPUT_DIR, "pii_annotations.json")
    with open(ann_path, "w") as f:
        json.dump(annotations, f, indent=2, default=str)
    print(f"Saved annotations to {ann_path}")

    print("\nData generation complete.")


if __name__ == "__main__":
    main()
