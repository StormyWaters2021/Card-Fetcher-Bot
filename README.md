# TCGBuilder Discord Bot
Fetches data from TCGBuilder.net to provided embedded card data to Discord servers. 

## Features
- Card lookup: `[Card Name]` - Requires near-exact match but can account for minor typos or spelling errors.
- Advanced search: `[partial card name | prop:value | otherprop>=3 | !type:event]` - Uses only partial name matches and also checks other card properties depending on the game. Supports numeric comparison and negations. 
- Embeds card name, type, text, and thumbnail. If same card is printed multiple times, provides links to other printings. Advanced search returns a list of links to matched results. 