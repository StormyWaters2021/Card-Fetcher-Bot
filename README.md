# TCGBuilder Discord Bot
Fetches data from TCGBuilder.net to provided embedded card data to Discord servers. 

## Features
- Card lookup: `[Card Name]` - Requires near-exact match but can account for minor typos or spelling errors.
- Advanced search: `[partial card name | prop:value | otherprop>=3 | !type:event]` - Uses only partial name matches and also checks other card properties depending on the game. Supports numeric comparison and negations. 
- Embeds card name, type, text, and thumbnail. If same card is printed multiple times, provides links to other printings. Advanced search returns a list of links to matched results. 

## To use the card fetcher bot:

- Wrap the card name in square brackets `[]`
- Needs a *near* exact match to find a card: `[Earth Dragon Ball 1]`
- Supports advanced searches by separating name and properties with `|` inside the brackets:
    - Leave the name space (before the first `|`) blank if you don't want to name search.
    - Use `[Goku | PUR>2]` or `[ | endurance:4]`
    - Supports *negation* (NOT): `[ Goku |!type: ally | text: draw]`
- Supports deck imports and embedding from TCGBuilder.net
    - Build your deck on TCGBuilder
	- Click "Export" > "Link"
	- Embed the deck: `[deck: (your link)]`