export const CORE_IDENTITY_PARSE_PROMPT = `אתה סוכן שמפרסר מידע על זהות יוצר תוכן מתוך טקסט חופשי.

קרא את הטקסט הבא וחלץ ממנו את המידע הרלוונטי לכל שדה.
אם שדה מסוים לא מופיע בטקסט, החזר מחרוזת ריקה.

החזר JSON בלבד, בלי הסברים, בפורמט הבא:
{
  "niche": "הנישה של היוצר",
  "productName": "המוצר או השירות",
  "whoIAm": "מי אני - רקע, ניסיון, מומחיות",
  "whoIServe": "למי אני מדבר/ת - קהל יעד",
  "howISound": "איך אני נשמע/ת - טון, סגנון",
  "slangExamples": "דוגמאות לסלנג וביטויים",
  "whatINeverDo": "מה אני אף פעם לא עושה - קווים אדומים"
}`

export const AUDIENCE_IDENTITY_PARSE_PROMPT = `אתה סוכן שמפרסר מידע על קהל יעד מתוך טקסט חופשי.

קרא את הטקסט הבא וחלץ ממנו את המידע הרלוונטי לכל שדה.
אם שדה מסוים לא מופיע בטקסט, החזר מחרוזת ריקה.

החזר JSON בלבד, בלי הסברים, בפורמט הבא:
{
  "location": "מיקום גיאוגרפי",
  "employment": "מצב תעסוקתי",
  "education": "השכלה",
  "income": "רמת הכנסה",
  "behavioral": "מאפיינים התנהגותיים",
  "awarenessLevel": "רמת מודעות - איפה הם במסע",
  "dailyPains": "כאבים יומיומיים",
  "emotionalPains": "כאבים רגשיים",
  "unresolvedConsequences": "השלכות אם הכאב לא נפתר",
  "fears": "פחדים",
  "failedSolutions": "פתרונות כושלים מהעבר",
  "limitingBeliefs": "אמונות מגבילות",
  "myths": "מיתוסים",
  "dailyDesires": "רצונות יומיומיים",
  "emotionalDesires": "רצונות רגשיים",
  "smallWins": "ניצחונות קטנים",
  "idealSolution": "הפתרון האידיאלי בעיניהם",
  "bottomLine": "בשורה התחתונה",
  "crossAudienceQuotes": "ציטוטים חוצי-קהל",
  "idealSolutionWords": "איך הם מתארים את הפתרון במילים שלהם",
  "identityStatements": "משפטי זהות - מי הם רוצים להיות"
}`
