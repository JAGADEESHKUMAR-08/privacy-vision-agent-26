import json
import random
import os

random.seed(42)

ELEMENTS = {
    "click_button": [
        "pending applications", "approved applications", "search applications",
        "submit form", "save changes", "cancel", "delete", "edit profile",
        "upload document", "download report", "close", "confirm", "apply now",
        "view details", "add item", "remove item", "refresh", "reload",
        "sign out", "log out", "settings", "notifications", "help",
        "back to home", "next page", "previous page", "reset", "clear",
        "accept", "reject", "approve", "deny", "submit", "send",
        "create new", "start", "begin", "finish", "complete", "pause",
        "resume", "retry", "skip", "proceed", "continue", "update",
        "verify", "validate", "check status", "track", "monitor",
        "expand", "collapse", "show more", "show less", "load more"
    ],
    "click_link": [
        "profile", "home", "applications", "dashboard", "settings",
        "help center", "privacy policy", "terms of service", "contact us",
        "about", "faq", "support", "documentation", "changelog",
        "application details", "my account", "user guide", "feedback",
        "community", "blog", "announcements", "news", "updates",
        "reports", "analytics", "statistics", "history", "logs",
        "archive", "downloads", "resources", "tools", "integrations",
        "api docs", "developer", "status page", "license", "credits"
    ],
    "fill_input": [
        "search box", "email field", "password field", "username",
        "first name", "last name", "phone number", "address",
        "city", "state", "zip code", "country", "date of birth",
        "organization", "department", "job title", "website",
        "bio", "description", "notes", "comments", "message",
        "subject", "query", "filter", "sort by", "date range",
        "start date", "end date", "min price", "max price",
        "keyword", "tag", "category", "status filter"
    ],
    "scroll": [
        "top of page", "bottom of page", "to comments", "to footer",
        "to header", "to sidebar", "to main content", "to navigation",
        "to search results", "to product list", "to testimonials",
        "to pricing", "to features", "to about section", "to contact form",
        "down", "up", "left", "right", "to next section", "to previous section"
    ],
    "search": [
        "applications", "documents", "profiles", "users", "products",
        "orders", "invoices", "reports", "records", "files",
        "pending applications", "approved applications", "items", "entries",
        "tickets", "payments", "subscriptions", "companies", "contacts",
        "messages", "notifications", "settings", "history", "logs",
        "projects", "tasks", "employees", "customers", "vendors", "clients"
    ]
}

QUERY_TERMS = [
    "application", "document", "form", "request", "report", "file",
    "profile", "account", "setting", "item", "entry", "record",
    "ticket", "order", "invoice", "payment", "subscription", "plan",
    "notification", "alert", "message", "email", "notification"
]

AUGMENT_PREFIXES = [
    "", "", "", "",  # no prefix (40%)
    "please ", "kindly ", "can you ", "could you ",
    "i want to ", "i need to ", "help me ", "go to ",
    "navigate to ", "find ", "show me ", "locate ",
    "open ", "access ", "bring up ", "pull up ",
    "click on ", "tap on ",
    "select ", "choose ", "pick ", "press "
]

AUGMENT_SUFFIXES = [
    "", "", "", "",  # no suffix (40%)
    " now", " please", " for me", " on the page",
    " in the app", " on this site", " right now",
    " quickly", " immediately", " asap"
]

BUTTON_PREFIXES = [
    "click the ", "press the ", "hit the ", "tap the ",
    "select the ", "choose the ", "activate the ",
    "", "", ""  # no prefix
]

LINK_PREFIXES = [
    "open the ", "go to the ", "navigate to the ",
    "visit the ", "access the ",
    "", "", ""  # no prefix
]

SEARCH_PREFIXES = [
    "search for ", "look up ", "find ", "query ",
    "type in ", "enter ", "input ", "search ",
    "", "", ""
]

FILL_PREFIXES = [
    "fill in the ", "enter text in the ", "type in the ",
    "put my ", "input my ", "write my ",
    "enter the ", "type the ",
    "", "", ""
]

SCROLL_PREFIXES = [
    "scroll to ", "scroll down to ", "scroll up to ",
    "move to ", "navigate to ",
    "", "", ""
]


def generate_task(category, element):
    if category == "click_button":
        prefix = random.choice(BUTTON_PREFIXES)
        suffix = random.choice(AUGMENT_SUFFIXES)
        task = prefix + element + suffix

    elif category == "click_link":
        prefix = random.choice(LINK_PREFIXES)
        suffix = random.choice(AUGMENT_SUFFIXES)
        task = prefix + element + suffix

    elif category == "fill_input":
        prefix = random.choice(FILL_PREFIXES)
        suffix = random.choice(AUGMENT_SUFFIXES)
        query = random.choice(QUERY_TERMS)
        if random.random() < 0.5:
            task = prefix + element + " with " + query + suffix
        else:
            task = prefix + element + suffix

    elif category == "scroll":
        prefix = random.choice(SCROLL_PREFIXES)
        suffix = random.choice(AUGMENT_SUFFIXES)
        task = prefix + element + suffix

    elif category == "search":
        prefix = random.choice(SEARCH_PREFIXES)
        suffix = random.choice(AUGMENT_SUFFIXES)
        task = prefix + element + suffix

    else:
        task = element

    # Apply global augmentation
    global_prefix = random.choice(AUGMENT_PREFIXES)
    task = global_prefix + task

    # Clean up
    task = task.strip()
    task = " ".join(task.split())  # normalize whitespace
    task = task.lower()

    return task


def generate_unknown_tasks(n):
    unknown_templates = [
        "what time is it",
        "tell me a joke",
        "what is the weather",
        "play music",
        "set a timer",
        "remind me to {q}",
        "call someone",
        "send a text",
        "take a photo",
        "record video",
        "translate this",
        "convert {q} to pdf",
        "calculate {q}",
        "what is {q}",
        "define {q}",
        "how to {q}",
        "why does {q}",
        "when was {q}",
        "who is {q}",
        "where is {q}",
    ]
    tasks = []
    for _ in range(n):
        template = random.choice(unknown_templates)
        q = random.choice(QUERY_TERMS)
        task = template.format(q=q)
        prefix = random.choice(AUGMENT_PREFIXES)
        suffix = random.choice(AUGMENT_SUFFIXES)
        task = (prefix + task + suffix).strip()
        task = " ".join(task.split()).lower()
        tasks.append({"task": task, "label": "unknown"})
    return tasks


def generate_dataset(samples_per_class=300):
    data = []

    for category, elements in ELEMENTS.items():
        for _ in range(samples_per_class):
            element = random.choice(elements)
            task = generate_task(category, element)
            data.append({"task": task, "label": category})

    unknown_tasks = generate_unknown_tasks(samples_per_class)
    data.extend(unknown_tasks)

    random.shuffle(data)
    return data


def main():
    data = generate_dataset(samples_per_class=350)
    print(f"Generated {len(data)} samples")

    label_counts = {}
    for item in data:
        label = item["label"]
        label_counts[label] = label_counts.get(label, 0) + 1
    for label, count in sorted(label_counts.items()):
        print(f"  {label}: {count}")

    output_path = os.path.join(os.path.dirname(__file__), "training_data.json")
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved to {output_path}")


if __name__ == "__main__":
    main()
