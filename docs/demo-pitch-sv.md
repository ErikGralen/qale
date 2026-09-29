# Demo-briefing, på svenska

Det här är för dig som ska demonstrera Qale utan att ha använt den själv. Den säger vad
produkten är, vad demot visar, och vilket scenario du ska välja beroende på vem du har framför
dig. Exakt vad du klickar och skriver står i `docs/demo-runbook.md` (steg för steg) och i
`demo-samples/README.md` (kortet du har bredvid dig under demot). Bakgrunden till scenarierna
finns i `docs/plan-demo-bookings.md`.

## Vad Qale är

Qale är ett Mac-program för en produktägare (PO). In går mötestranskript, Slack-meddelanden och
annat material. Ut kommer godkända uppdateringar i Jira och Confluence, färdiga svar till
kollegor och kunder, och ett minne över vad som sagts och beslutats.

Minnet är en vanlig mapp med markdown-filer: möten, beslut, kunder, personer, todos, research.
Filerna länkar till varandra och versioneras med git. Mappen går att läsa och redigera i vilken
texteditor som helst, med Qale stängd.

Qale gör tre saker med det den läser:

1. Skriver ner vad som hände, och länkar det till rätt kund, person, ticket och beslut.
2. Fångar det som PO:n själv missade: ett datum som nämndes i förbifarten, en klagan som matchar
   en öppen bugg, ett säljlöfte som strider mot ett fattat beslut. Det är alltid en fråga med
   källa och datum, aldrig en gissning.
3. Skriver det som ska vidare, i rätt form: en Jira-kommentar, en Confluence-ändring, ett
   meddelande till en kund, ett veckobrev.

Användaren är en PO på ett nordiskt produktbolag med 30 till 300 anställda, som redan har Jira
och Confluence. Hon installerar Qale själv, ensam, utan att teamet behöver ändra något. Hon
använder den i minuterna efter ett möte.

## Vad som gör den annorlunda

Två regler bär hela produkten. Säg dem tidigt i demot, för de förklarar allt som händer på
skärmen.

**Ingenting lämnar datorn utan ett ja.** Allt som skickas till Jira, Confluence eller en kund
väntar som ett kort med en läsbar ändring. Samma sak när Qale vill skriva om text PO:n själv
skrivit, radera något, eller när den har antagit något. Resten landar direkt: mötesanteckningen,
en todo, ett tillägg på en sida, allt i Qales eget minne.

**Allt som landar går att ångra.** Varje skrivning är en git-commit och listas under Activity,
med ett klick för att lägga tillbaka. Det är därför Qale vågar skriva utan att fråga.

Utöver det:

- Varje påstående har källa och datum. Ett svar utan täckning ser annorlunda ut än ett med.
- Mottaget och skrivet hålls isär. Ett transkript PO:n fick blandas aldrig med det hon själv
  skrev.
- Minnet växer. Vecka 6 är synligt bättre än vecka 1, för varje möte och beslut ligger kvar och
  länkas. Ingen konkurrent kan bygga den historiken i efterhand.
- Qales egna arbetsbeskrivningar är markdown-filer som PO:n kan läsa och ändra.

Vi har inga kunder, inga referenser och inget pris ännu. Säg inte att vi har.

## Demot: Bord

Demot utspelar sig hos **Bord**, ett bolag som gör bordsbokning för restauranger. Gästen bokar på
restaurangens webb eller via Google, och får ett sms dagen innan. Du är PO för två team, Bookings
(Jira `BOK`) och Guest (Jira `GST`). Den stora grejen på gång är **no-show-avgifter**: ett kort
sparas vid bokning och dras om gästen inte dyker upp.

Orden är valda så att ingen i rummet behöver få dem förklarade. Bokningar, gäster, bord,
no-shows, påminnelser.

Tre saker driver historien:

- Brasserie Lund, största kunden, behöver no-show-avgifter före jul. På gårdagens möte sa du
  "slutet av oktober". Det står ingenstans.
- En bugg (`BOK-412`, dubbla sms) fixades i morse. Tre kunder och en supportkö väntar på besked.
- Säljchefen Marcus vill lova en prospekt gruppbokningar, som styrgruppen redan skjutit till Q1
  2027.

Reglerna: en Reset före demot, ingen mellan scenarierna. Scenario 1 och 2 kör du alltid, i den
ordningen. Av 3 till 6 väljer du två till fyra, i valfri ordning, varje högst en gång. Allt Qale
gör i demot är inspelat, så svaren blir desamma varje gång. Skriver du något utanför manus säger
Qale att det ligger utanför demot. Då är det bara att fortsätta.

## Vilket scenario ska du välja?

Lyssna efter vad personen är trött på, och välj därefter.

| Personen säger ungefär | Kör |
|---|---|
| "Ingen skriver ner vad som sas på mötet" | 1 (alltid) |
| "Att skriva tickets tar hela eftermiddagen" | 2 (alltid) |
| "Kunder får aldrig veta att deras problem är löst", "CS och support får inte veta något" | 3 |
| "Sälj pingar mig hela tiden", "jag är den enda som vet vad som är beslutat" | 4 |
| "Fredagsuppdateringen är ett skrivjobb ingen hinner", "changeloggen är alltid efter" | 5 |
| "Jag går in på möten utan att veta vad folk hört", "ledningsmöten kräver en timmes förberedelse" | 6 |

Grova tumregler för publik:

- PO eller produktchef med många kundkontakter: 3 och 6.
- PO som sitter nära sälj, eller en säljchef i rummet: 4 och 6.
- Produktchef eller CPO som vill se hur teamet kommunicerar: 5 och 6.
- Någon som är skeptisk till AI som skriver i Jira: kör 1 och 2 långsamt, visa korten och
  ångra-raden i Activity, och lägg till 4 för att visa att Qale säger nej när beslutet säger nej.
- Kort på tid: 1, 2 och ett av de andra. Scenario 6 är det snabbaste, ett klick.

## Scenario 0: Rundtur utan manus

Visa arbetsytan innan du kör något. Det tar en minut och ger resten ett sammanhang.

I vänsterkanten: Home (chatt och start), Calendar (möten, med en knapp för att få en brief), Todos,
Sessions (varje jobb Qale kört, öppet och läsbart), Documents (PO:ns egna sidor). Under Jira och
Confluence ligger speglar av tickets och sidor. I foten: Memory (allt Qale kommit ihåg, sorterat
i hyllor) och Activity (allt Qale gjort, med ångra på varje rad).

Öppna en kund, till exempel Brasserie Lund. Visa att sidan har vad de blivit lovade och när, med
länk till mötet det sas på. Öppna ett beslut och visa att det har datum, vem som fattade det och
vad det ersatte.

Problemet det svarar på: en PO:s verktyg ligger utspridda över Jira, Confluence, Slack,
anteckningar och kalender, och inget av dem minns åt henne eller hänger ihop.

## De sex scenarierna

Varje scenario nedan säger vad du gör, vad som händer, vilket problem det löser och när det är
rätt val. Exakta meningar och klick står i runbooken.

### 1. Mötet blev till åtgärder (alltid, först)

**Du gör:** drar in transkriptet från gårdagens kundmöte och skriver en rad om att ingen
antecknade.

**Som händer:** Qale lägger transkriptet på rätt möte i kalendern, skriver mötesanteckningen och
ställer två frågor på ett kort. Den ena: "du sa slutet av oktober, senast på pränt är Q4, gäller
oktober nu?" Den andra: "Lena nämnde dubbla sms, det är buggen som fixades i morse, samma sak?"
Efter dina svar landar anteckningen, kundsidan, tre todos med ägare och datum. Tre kort väntar:
två Jira-kommentarer och en ändring på roadmap-sidan. Du godkänner dem ett i taget och öppnar
tickets i Jira för att visa kommentaren.

**Problemet:** det som sägs på möten skrivs sällan ner, och besluten hamnar aldrig där teamet
eller kunden ser dem.

**Fördelen:** Qale fångade ett datum du gav muntligt och en klagan som redan hade en fix. Inget
skickades utan ditt ja.

**Kör det:** alltid. Det är här du visar de två reglerna, frågan med källa och korten som
väntar.

### 2. Förfina epiken (alltid, som tvåa)

**Du gör:** väljer "Iterate on something" och ber Qale hjälpa till att bryta ner epiken för
no-show-avgifter, så att teamet kan börja på onsdag.

**Som händer:** Qale ramar in vad som ska bestämmas och ställer frågor i två rundor. Först
avgränsning (behåll eller stryk tre idéer, en av dem citerad från ett gammalt möte). Sedan tre
stories med tre acceptanskriterier var. Tre ticket-kort väntar, i teamets egen stil: rätt
etikett, kunden på första raden, tre checkrutor. Du godkänner ett och visar det i Jira. Todon
från 1:1 med techleaden stängs av sig själv.

**Problemet:** att skriva om ett önskemål till bra tickets tar tid, och varje PO har en stil som
är svår att hålla konsekvent.

**Fördelen:** tickets på minuter, i rätt form, utan copy-paste. Qale frågade bara det som
behövde bestämmas.

**Kör det:** alltid. Det bygger direkt på datumet från scenario 1.

### 3. Vem borde veta?

**Du gör:** skriver i Home att fixen för `BOK-412` gick ut i morse, och frågar vem som borde få
veta.

**Som händer:** Qale svarar med tre namn ur minnet, två CS-ansvariga och supportchefen, och
varför var och en väntar (vilken kund, vilket datum, vilken supportkö). Den nämner kunden som
lämnade 2025 för att ingen sa att buggen var fixad. Två textpaneler att kopiera: ett
kundmeddelande i CS-rösten, en rad för support att stänga ärenden med. Inget skickas. Valfri
andra tur: skriv "från och med nu, säg till CS före changeloggen", och Qale lägger in det som
en stående regel.

**Problemet:** det är lätt att glömma vem som frågade om vad, och fel person får aldrig veta att
något är löst.

**Fördelen:** ingen kund eller kollega glöms, texten är redan skriven i rätt röst, och en regel
du sa en gång gäller sedan.

**Kör det:** för en PO med många kundkontakter, eller när CS och support sitter i rummet. Bra
när personen vill se att minnet faktiskt håller koll på människor, inte bara tickets. Den
andra turen är för den som frågar "kan jag lära den hur vi jobbar?".

### 4. Sälj behöver ett ja

**Du gör:** klistrar in ett brådskande Slack-meddelande från säljchefen. Han vill lova en
prospekt två saker för att stänga affären. Du väljer ingen skill; Qale känner igen ett
åtagande själv.

**Som händer:** Qale kollar båda sakerna mot minnet. Den ena har varit live sedan maj, och
ingen berättade för sälj. Den andra sköts till Q1 2027 av styrgruppen, med länk till beslutet.
Ett kort med en enda fråga: vill du flytta upp den? Du svarar nej. Qale skriver ett svar i
säljrösten som Marcus kan vidarebefordra, med vad prospekten kan få nu och varför inte resten.
Inget skickas. Avslutet: "Ett ja och ett nej. Ja:et levererades i maj och ingen sa det till
sälj. Nej:et beslutades i juni och inget har ändrat det."

**Problemet:** PO:n är den enda som vet vad som är live och vad som är beslutat, så sälj pingar
henne för varje löfte.

**Fördelen:** ett korrekt svar på sekunder, utan att gräva. Qale flaggar när frågan strider mot
ett beslut, och säger nej när nej är svaret.

**Kör det:** när sälj är en smärtpunkt, när en säljchef eller CPO sitter i rummet, eller när
personen är skeptisk till AI som "bara säger ja". Det är det bästa scenariot för att visa att
Qale följer beslut, inte önskemål.

### 5. Fredagsuppdateringen

**Du gör:** väljer "Write the weekly update" och skickar utan text.

**Som händer:** en textpanel för den interna kanalen, i två längder: levererat, ändrat, att
bevaka. Allt hämtat ur vad som faktiskt hände i veckan, inklusive oktoberdatumet från scenario
1. Ett kort väntar: veckans avsnitt på den publika changeloggen, utan ticketnummer, kundnamn
eller måldatum. Du godkänner och visar avsnittet i Confluence.

**Problemet:** statusuppdateringar och changelogs är repetitiva, tar tid varje vecka och glider
isär mellan kanaler.

**Fördelen:** skrivet en gång, i rätt ton för varje mottagare, ur det som verkligen ändrats. Du
godkänner bara.

**Kör det:** för produktchefer och CPO:er som vill se hur teamet kommunicerar utåt, eller en PO
som suckar över fredagar. Om någon frågar "kan den skriva för olika mottagare?", öppna mappen
`voices/` och visa de tre rösterna.

### 6. Briefen inför torsdag

**Du gör:** öppnar Calendar, klickar på torsdagens styrgruppsmöte och trycker "Get the brief".

**Som händer:** en Prep-sektion landar på mötessidan, utan kort. Sedan sist: oktoberdatumet,
som CPO:n inte hört än. Tickets: vad som är fixat och vad som saknar datum. Vem som är skyldig ett
svar: Henrik, ett datum för deposits. Vad som kommer upp: Marcus kommer att driva gruppbokningar
igen, och svaret är beslutet från juni.

**Problemet:** att förbereda sig betyder att leta status i flera system och komma ihåg vem som
hört vad.

**Fördelen:** du kommer förberedd på ett klick, och vet vad som kommer upp innan det gör det.

**Kör det:** nästan alltid som avslutning, för det knyter ihop det som hänt tidigare i demot.
Det är det snabbaste scenariot och passar när tiden är knapp. Särskilt bra för någon som sitter
i många ledningsmöten.

## Om något går fel

Reset under Settings, Demo, och börja om från scenario 1. Varje scenario går bara att köra en
gång per Reset. Mer i `docs/demo-runbook.md` under "Known limits".
