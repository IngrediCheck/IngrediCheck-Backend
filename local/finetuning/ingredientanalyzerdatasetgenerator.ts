#!/usr/bin/env deno run --allow-read --allow-write
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fromFileUrl } from "https://deno.land/std/path/mod.ts"
import {
    ingredientAnalyzerAgentFunctions,
    ingredientAnalyzerAgentSystemMessage
} from '../../supabase/functions/shared/llm/ingredientanalyzeragent_types.ts'

const trainingData = [
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
None
---------------------
Analyze this product:
Name: Berry blend strawberries, blueberries & blackberries, berry blend
Brand: Whole Foods Market, Inc.
Ingredients:
strawberries, blueberries, blackberries
`
        },
        {
            role: 'assistant',
            function_call: { name: "record_not_safe_to_eat", arguments: JSON.stringify({ ingredients: [] }) }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
None
---------------------
Analyze this product:
Name: Mexican Blend
Brand: Whole Foods Market, Inc.
Ingredients:
Monterey jack cheese (cultured pasteurized milk, salt, microbial enzymes), cheddar cheese (cultured pasteurized milk, salt, microbial enzymes), queso blanco cheese (cultured pasteurized milk, salt, microbial enzymes), asadero cheese (cultured pasteurized milk, salt, microbial enzymes), powdered cellulose
`
        },
        {
            role: 'assistant',
            function_call: { name: "record_not_safe_to_eat", arguments: JSON.stringify({ ingredients: [] }) }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
Flag aspartame and high fructose corn syrup
No seed oils
No added sugar 
No high fructose corn syrup
---------------------
Analyze this product:
Name: null
Brand: null
Ingredients:
Milk, Cream, Sugar, Corn Syrup, Nonfat Milk, High Fructose Corn Syrup, Whey, Strawberries, Cocoa Processed with Alkali, Mono & Diglycerides, Guar Gum, Locust Bean Gum, Polysorbate 80, Carrageenan, Modified Corn Starch, Citric Acid, Natural & Artificial Flavors, Red Beet Juice Concentrate, Annatto (Color)
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Sugar", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "Corn Syrup", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "Corn Syrup is a form of added sugar." },
                        { ingredientName: "High Fructose Corn Syrup", safetyRecommendation: "DefinitelyUnsafe", preference: "No high fructose corn syrup", reasoning: "self-explanatory" },
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No seed oils
No added sugar 
No high fructose corn syrup
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Honey Dijon
Brand: null
Ingredients:
potatoes, vegetable oils (canola, sunflower, safflower), honey (cane syrup, honey), mustard (vinegar, mustard seeds, salt, turmeric), salt, garlic, onion, citric acid, spice
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "canola", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Canola Oil is a seed oil." },
                        { ingredientName: "sunflower", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Sunflower Oil is a seed oil." },
                        { ingredientName: "safflower", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Safflower Oil is a seed oil." },
                        { ingredientName: "cane syrup", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "Cane Syrup is a form of added sugar." },
                        { ingredientName: "garlic", safetyRecommendation: "DefinitelyUnsafe", preference: "I don't feel good after eating garlic", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
Flag aspartame and high fructose corn syrup
I cannot eat onion or garlic due to religious reasons
No seed oils
---------------------
Analyze this product:
Name: Asian Vegetable Ramen
Brand: KOYO
Ingredients:
Organic Noodles (Organic Wheat Flour, Sea Salt), Soup Packet (Sea Salt, Chinese Mushroom Powder, Onion & Garlic Powder, Garlic, Chili Pepper, Ginger, Snow Peas, Sweet Red Bell Pepper, Green Onion, Black Pepper, Kombu Powder)
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Garlic Powder", safetyRecommendation: "DefinitelyUnsafe", preference: "I cannot eat onion or garlic due to religious reasons", reasoning: "self-explanatory" },
                        { ingredientName: "Garlic", safetyRecommendation: "DefinitelyUnsafe", preference: "I cannot eat onion or garlic due to religious reasons", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
Flag aspartame and high fructose corn syrup
No seed oils
No added sugar 
No eggs no gelatin
No high fructose corn syrup
I don’t like vanilla flavoring
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Sardines in Extra Virgin Olive Oil with Lemon and Smoke Flavor
Brand: BELA
Ingredients:
Sardines (Sardina Pilchardus), Organic Extra Virgin Olive Oil, Natural Lemon Flavor, Natural Smoke Flavor, Sea Salt
`
        },
        {
            role: 'assistant',
            function_call: { name: "record_not_safe_to_eat", arguments: JSON.stringify({ ingredients: [] }) }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
Flag aspartame and high fructose corn syrup
No seed oils
No added sugar 
No eggs no gelatin
No high fructose corn syrup
I don’t like vanilla flavoring
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Madry Sourdough Cheese Bagels
Brand: Macrina Bakery
Ingredients:
enriched organic white wheat flour (organic wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid, ascorbic acid), water, parmesan cheese (pasteurized milk, cheese cultures, salt, enzymes, powdered cellulose), sharp white cheddar cheese (pasteurized milk, salt, culture, enzymes), organic coarse rye flour, sea salt, organic malted barley flour, parsley, organic yeast (organic yeast, ascorbic acid), sage, rosemary, oregano, thyme
`
        },
        {
            role: 'assistant',
            function_call: { name: "record_not_safe_to_eat", arguments: JSON.stringify({ ingredients: [] }) }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No salt
No beef, pork and animal products
---------------------
Analyze this product:
Name: Goldfish
Brand: PEPPERIDGE FARM
Ingredients:
made with smiles and enriched wheat flour (flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), cheddar cheese (annatto), canola, sunflower oils, contains 2 percent and less of (salt), yeast, sugar, autolyzed yeast, baking soda, monocalcium phosphate, paprika, spices, celery, onion
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "cheddar cheese", safetyRecommendation: "MaybeUnsafe", preference: "No beef, pork and animal products", reasoning: "It is not mentioned whether Animal Rennet was used in the preparation of this Cheddar Cheese." },
                        { ingredientName: "salt", safetyRecommendation: "DefinitelyUnsafe", preference: "No salt", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
Flag aspartame and high fructose corn syrup
No seed oils
No added sugar 
No eggs no gelatin
No high fructose corn syrup
I don’t like vanilla flavoring
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Yellow Corn Taco Shells
Brand: Simple Truth Organic
Ingredients:
Organic Masa Flour, Organic Yellow Corn, Expeller Pressed Sunflower Oil and/or Organic Expeller Pressed Safflower Oil, Trace of Lime
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Expeller Pressed Sunflower Oil", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Sunflower Oil is a seed oil." },
                        { ingredientName: "Organic Expeller Pressed Safflower Oil", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Safflower Oil is a seed oil." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No seed oils
No added sugar 
No high fructose corn syrup
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Alfredo Sauce Mix
Brand: Simply Organic
Ingredients:
Organic Nonfat Dry Milk, Organic Maltodextrin, Organic Potato Starch, Sea Salt, Organic Natural Flavor (Organic Maltodextrin, Organic Natural Butter Flavor, Natural Flavor), Organic Garlic, Organic Rice Concentrate, Organic White Pepper, Organic Nutmeg
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Organic Maltodextrin", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "Maltodextrin can be considered a form of added sugar." },
                        { ingredientName: "Organic Garlic", safetyRecommendation: "DefinitelyUnsafe", preference: "I don’t feel good after eating garlic", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No seed oils
No added sugar 
No eggs no gelatin
---------------------
Analyze this product:
Name: Almond Flour Baking Mix Brownie
Brand: Simple Mills
Ingredients:
Almond Flour, Organic Coconut Sugar, Chocolate Chips (Cane Sugar, Cocoa Liquor, Cocoa Butter), Dutch Cocoa Powder, Tapioca Starch, Arrowroot, Sea Salt, Baking Soda
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Organic Coconut Sugar", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "Cane Surag", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
Flag aspartame and high fructose corn syrup
No seed oils
No added sugar 
No eggs no gelatin
No high fructose corn syrup
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Classic Crepe Baking Mix
Brand: Unknown
Ingredients:
ENRICHED UNBLEACHED FLOUR (WHEAT FLOUR, NIACIN, REDUCED IRON, THIAMIN MONONITRATE, RIBOFLAVIN, FOLIC ACID, MALTED BARLEY FLOUR), WHEY (MILK PROTEIN), SOYBEAN OIL, DEXTROSE, NONFAT MILK, SALT, NATURAL FLAVOR (CONTAINS MILK DERIVATIVES), COLOR (TURMERIC, ANNATTO)
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "SOYBEAN OIL", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Soybean oil is a type of seed oil." },
                        { ingredientName: "DEXTROSE", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "Dextrose is a form of added sugar." },
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No animal products except eggs and dairy are ok
Flag aspartame and high fructose corn syrup
No seed oils
No added sugar 
No eggs no gelatin
No high fructose corn syrup
I don’t like vanilla flavoring
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Keto Nut Granola
Brand: null
Ingredients:
SUNFLOWER SEEDS, PUMPKIN SEEDS, COCONUT, ALMONDS, PECANS, ERYTHRITOL, BUTTER (CREAM, NATURAL FLAVOR), BLUEBERRIES, CINNAMON, SALT, MONK FRUIT EXTRACT
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: []
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No animal products except eggs and dairy are ok
No seed oils
No added sugar 
No eggs no gelatin
I don’t like vanilla flavoring
---------------------
Analyze this product:
Name: Pepermint hot chocolate
Brand: Honeypot Treats
Ingredients:
Bittersweet chocolate: (sugar, chocolate liquor, cocoa butter, natural vanilla flavor, soy lecithin (emulsifier))
cane sugar
coconut oil
non fat milk powder
cocoa
maltodextrin: (corn)
natural mint flavor
tricalcium phosphate
guar gum
sodium caseinate: (a milk derivative)
mono- and diglycerides
dipotassium phosphate
silicon dioxide
salt
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "sugar", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "cane sugar", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "natural vanilla flavor", safetyRecommendation: "DefinitelyUnsafe", preference: "I don't like vanilla flavoring", reasoning: "self-explanatory" },
                        { ingredientName: "mono- and diglycerides", safetyRecommendation: "MaybeUnsafe", preference: "No animal products except eggs and dairy are ok", reasoning: "Source of the mono- and diglycerides could be animal-based." },
                        { ingredientName: "mono- and diglycerides", safetyRecommendation: "MaybeUnsafe", preference: "No seed oils", reasoning: "Mono- and diglycerides may have been derived from seed oils." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No animal products except eggs and dairy are ok
No seed oils
No added sugar 
---------------------
Analyze this product:
Name: White corn tortilla chips
Brand: null
Ingredients:
stone ground white corn, vegetable oil (sunflower, safflower, canola)
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "sunflower", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Sunflower Oil is a seed oil." },
                        { ingredientName: "safflower", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Safflower Oil is a seed oil." },
                        { ingredientName: "canola", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Canola Oil is a seed oil." },
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No seed oils
No added sugar 
No eggs no gelatin
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Roasted Hatch Chile & Jalapeno Cheese Dip
Brand: Trader Joe's
Ingredients:
Sour Cream (Cultured Pasteurized Cream), Sharp Cheddar Cheese (Pasteurized Milk, Cheese Cultures, Salt, Microbial Enzymes, Annatto Extract (Color)), Cream Cheese (Pasteurized Cultured Milk and Cream, Salt, Stabilizers (Carob Bean Gum and Guar Gum)), Roasted Hatch Green Chile Peppers, Roasted Green Jalapeno Peppers, Jalapeno Peppers, Cornstarch, Sea Salt, Roasted Garlic Puree, Yeast Extract, Onion Powder, Smoked Paprika (Paprika, Rosemary Extract [To Preserve])
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Roasted Garlic Puree", safetyRecommendation: "DefinitelyUnsafe", preference: "I don’t feel good after eating garlic", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No seed oils
No added sugar 
No eggs no gelatin
---------------------
Analyze this product:
Name: Simply Nutty Dark Chocolate, Peanut & Almond Bar
Brand: Trader Joe's
Ingredients:
Peanuts
Almonds
Inulin (Dietary Fiber)
Dark Chocolate: (Sugar, Chocolate Liquor Processed with Alkali, Cocoa Butter, Soy Lecithin (Emulsifier), Vanilla Extract)
Honey
Pea Protein Crisp Rice: (Pea Protein Concentrate, Brown Rice Flour (Rice Flour, Rice Bran))
Pea Protein Isolate
Sea Salt
Expeller Pressed Canola Oil
Peanut Oil
Vegetable Glycerin
Soy Lecithin
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Expeller Pressed Canola Oil", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Canola Oil is a seed oil." },
                        { ingredientName: "Peanut Oil", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Peanut Oil is a seed oil." },
                        { ingredientName: "Honey", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "Honey is a form of added sugar." },
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No seed oils
No added sugar 
No eggs no gelatin
I don’t like vanilla flavoring
A friend recommended to avoid palm oil
---------------------
Analyze this product:
Name: Simply Nutty Bars
Brand: null
Ingredients:
Peanuts, Almonds, Walnuts, Dark chocolate (sugar, chocolate liquor, cocoa butter, soy lecithin, vanilla extract), Honey, Pea protein crisp rice (pea protein, brown rice flour, rice flour, rice bran), Pea protein isolate, Sea salt, Vanilla extract, canola oil, Vegetable glycerin
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "canola oil", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Canola Oil is a seed oil." },
                        { ingredientName: "Honey", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "Honey is a form of added sugar." },
                        { ingredientName: "vanilla extract", safetyRecommendation: "DefinitelyUnsafe", preference: "I don’t like vanilla flavoring", reasoning: "self-explanatory" },
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No seed oils
No added sugar 
A friend recommended to avoid palm oil
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Home made Marinara
Brand: null
Ingredients:
Italian Whole Peeled Tomatoes, Olive Oil, Onions, Salt, Garlic, Basil, Black Pepper, Oregano
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Garlic", safetyRecommendation: "DefinitelyUnsafe", preference: "I don’t feel good after eating garlic", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
I’m vegetarian
No palm oil
I can’t stand garlic
---------------------
Analyze this product:
Name: Natural goodness natural goodness
Brand: CAMPBELL SOUP COMPANY
Ingredients:
chicken stock, salt, natural flavoring, chicken fat, yeast extract, water, carrot juice, celery juice, onion, adds a trivial amount of fat
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "chicken stock", safetyRecommendation: "DefinitelyUnsafe", preference: "I’m vegetarian", reasoning: "self-explanatory" },
                        { ingredientName: "chicken fat", safetyRecommendation: "DefinitelyUnsafe", preference: "I’m vegetarian", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No alcohol 
No palm oil
No meat
---------------------
Analyze this product:
Name: Garlic Khakhra
Brand: OM SURAJ IMPEX
Ingredients:
Whole Wheat Flour, Edible Oil, Iodized Salt, Garlic Paste, Green Chilli, Turmeric Powder
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Edible Oil", safetyRecommendation: "MaybeUnsafe", preference: "No palm oil", reasoning: "Edible Oil could be Palm Oil." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
I’m vegetarian
No palm oil
I can’t stand garlic
---------------------
Analyze this product:
Name: 365 everyday value, organic black forest uncured ham
Brand: Whole Foods Market, Inc.
Ingredients:
pork, water, distilled white vinegar, salt, evaporated cane sugar, molasses, celery powder, spice (cinnamon, clove, capsicum)
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "pork", safetyRecommendation: "DefinitelyUnsafe", preference: "I’m vegetarian", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
Dr berg said avoid maltodextrin because it’s glycemic index is higher than 116
No animal products except eggs and dairy are ok
Flag aspartame and high fructose corn syrup
No added sugar 
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Peppermint Hot Chocolate
Brand: Trader Joe's
Ingredients:
Bittersweet Chocolate (Sugar, Chocolate Liquor, Cocoa Butter, Natural Vanilla Flavor), Soy Lecithin Emulsifier, Coconut Oil, Nonfat Dry Milk Powder, Cocoa, Maltodextrin (Corn), Natural Peppermint Flavor, Tricalcium Phosphate, Guar Gum, Sodium Caseinate (a Milk Derivative), Mono- and Diglycerides, Potassium Phosphate, Silicon Dioxide, Salt
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Sugar", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "Maltodextrin (Corn)", safetyRecommendation: "DefinitelyUnsafe", preference: "Dr berg said avoid maltodextrin because it’s glycemic index is higher than 116", reasoning: "self-explanatory" },
                        { ingredientName: "Mono- and Diglycerides", safetyRecommendation: "MaybeUnsafe", preference: "No animal products except eggs and dairy are ok", reasoning: "Source of the mono- and diglycerides could be animal-based." },
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No added sugar
No seed oils
No animal products except eggs and dairy are ok
Flag aspartame and high fructose corn syrup.
I can’t stand the taste of cardamom
---------------------
Analyze this product:
Name: Sardines
Brand: I. Epstein & Sons, Inc.
Ingredients:
Sardines, olive oil, salt
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Sardines", safetyRecommendation: "DefinitelyUnsafe", preference: "No animal products except eggs and dairy are ok", reasoning: "Sardines are Fish, and hence an animal product." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No added sugar
No seed oils
No animal products except eggs and dairy are ok
A friend recommended to avoid palm oil
---------------------
Analyze this product:
Name: Shrimp wontons with szechuan sauce
Brand: null
Ingredients:
SHRIMP WONTONS: (SHRIMP (FARM RAISED))
WONTON WRAPPER: (WHEAT FLOUR, WATER, MODIFIED TAPIOCA STARCH, SALT)
JICAMA: (YAMBEAN)
NATURAL SEASONING: (SESAME OIL, SUGAR, SALT, WHITE PEPPER)
POTATO STARCH
CARROT
ONION SICHUAN SAUCE: (NATURAL SEASONING, SUGAR)
SOYBEAN OIL
SESAME OIL
VINEGAR
CHILI
YEAST EXTRACT
WATER
ONION
SOY SAUCE: (SALT, SOYBEAN, WHEAT, ALCOHOL)
SPRING ONION
GARLIC
SHELLFISH: (SHRIMP)
SOYBEAN
WHEAT
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "SUGAR", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "SESAME OIL", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Sesame Oil is a seed oil." },
                        { ingredientName: "SOYBEAN OIL", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Soybean Oil is a seed oil." },
                        { ingredientName: "SHRIMP", safetyRecommendation: "DefinitelyUnsafe", preference: "No animal products except eggs and dairy are ok", reasoning: "Shrimp is a type of ShellFish, and hence an animal product." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
`My dietary preferences and restrictions:
No meat
No added sugar
No seed oils
Dr berg said avoid maltodextrin because it’s glycemic index is higher than 116
Flag aspartame and high fructose corn syrup.
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Maryland style mini crab cakes
Brand: Whole Foods Market, Inc.
Ingredients:
Blue crab, panko breadcrumbs (wheat flour, sugar, yeast, salt), mayonnaise† (canola oil, cage-free egg yolks, water, honey, distilled white vinegar, cage-free eggs, contains less than 2% of sea salt, spice, lemon juice concentrate), green onions, egg whites, lemon juice, seasoning (sea salt, paprika, garlic, sunflower seed oil, paprika oleoresin, celery, allspice, black pepper, mustard seed, bay leaf, cayenne pepper, nutmeg, ginger, cardamom, cinnamon, celery seed, cloves, mace, onion), yellow mustard (apple cider vinegar, water, mustard seed, sea salt, turmeric, paprika, spices)
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Blue crab", safetyRecommendation: "DefinitelyUnsafe", preference: "No meat", reasoning: "Blue crab is a type of seafood." },
                        { ingredientName: "sugar", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "canola oil", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Canola Oil is a seed oil." },
                        { ingredientName: "sunflower seed oil", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Sunflower Seed Oil is a seed oil." },
                        { ingredientName: "cardamom", safetyRecommendation: "DefinitelyUnsafe", preference: "I can’t stand the taste of cardamom", reasoning: "self-explanatory" },
                        { ingredientName: "garlic", safetyRecommendation: "DefinitelyUnsafe", preference: "I don’t feel good after eating garlic", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
`My dietary preferences and restrictions:
No meat
No added sugar
No seed oils
Dr berg said avoid maltodextrin because it’s glycemic index is higher than 116
Flag aspartame and high fructose corn syrup.
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: All Natural Smoked Wild Kippers
Brand: BAR HARBOR
Ingredients:
herring fillets, salt
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "herring fillets", safetyRecommendation: "DefinitelyUnsafe", preference: "No meat", reasoning: "Herring is a type of fish, and so this is meat." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
                `My dietary preferences and restrictions:
No meat
No added sugar
No seed oils
Dr berg said avoid maltodextrin because it’s glycemic index is higher than 116
Flag aspartame and high fructose corn syrup.
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Skipjack Wild Tuna
Brand: Wild Planet Foods, Inc.
Ingredients:
Skipjack tuna (katsuwonus pelamis), sea salt
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Skipjack tuna", safetyRecommendation: "DefinitelyUnsafe", preference: "No meat", reasoning: "Skipjack tuna is a type of fish, and so this is meat." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
`My dietary preferences and restrictions:
No meat
No added sugar
No seed oils
Dr berg said avoid maltodextrin because it’s glycemic index is higher than 116
No animal products except eggs and dairy are ok
Flag aspartame and high fructose corn syrup.
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Sardines
Brand: I. Epstein & Sons, Inc.
Ingredients:
Sardines, olive oil, salt
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "Sardines", safetyRecommendation: "DefinitelyUnsafe", preference: "No meat", reasoning: "Sardines are a type of fish, and so this is meat." }
                    ]
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content:
`My dietary preferences and restrictions:
No added sugar
No seed oils
No animal products except eggs and dairy are ok
A friend recommended to avoid palm oil
I can’t stand the taste of cardamom
I don’t feel good after eating garlic
---------------------
Analyze this product:
Name: Shrimp wontons with szechuan sauce
Brand: null
Ingredients:
SHRIMP WONTONS: (SHRIMP (FARM RAISED))
WONTON WRAPPER: (WHEAT FLOUR, WATER, MODIFIED TAPIOCA STARCH, SALT)
JICAMA: (YAMBEAN)
NATURAL SEASONING: (SESAME OIL, SUGAR, SALT, WHITE PEPPER)
POTATO STARCH
CARROT
ONION SICHUAN SAUCE: (NATURAL SEASONING, SUGAR)
SOYBEAN OIL
SESAME OIL
VINEGAR
CHILI
YEAST EXTRACT
WATER
ONION
SOY SAUCE: (SALT, SOYBEAN, WHEAT, ALCOHOL)
SPRING ONION
GARLIC
SHELLFISH: (SHRIMP)
SOYBEAN
WHEAT
`
        },
        {
            role: 'assistant',
            function_call: {
                name: "record_not_safe_to_eat",
                arguments: JSON.stringify({
                    ingredients: [
                        { ingredientName: "SUGAR", safetyRecommendation: "DefinitelyUnsafe", preference: "No added sugar", reasoning: "self-explanatory" },
                        { ingredientName: "SESAME OIL", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Sesame Oil is a seed oil." },
                        { ingredientName: "SOYBEAN OIL", safetyRecommendation: "DefinitelyUnsafe", preference: "No seed oils", reasoning: "Soybean Oil is a seed oil." },
                        { ingredientName: "SHRIMP", safetyRecommendation: "DefinitelyUnsafe", preference: "No animal products except eggs and dairy are ok", reasoning: "Shrimp is a type of ShellFish, and hence an animal product." },
                        { ingredientName: "GARLIC", safetyRecommendation: "DefinitelyUnsafe", preference: "I don’t feel good after eating garlic", reasoning: "self-explanatory" }
                    ]
                })
            }
        }
    ]
]

const finetuningData = trainingData.map((messages: any) => {
    messages.unshift({
        role: 'system',
        content: ingredientAnalyzerAgentSystemMessage
    })
    return {
        messages: messages,
        functions: ingredientAnalyzerAgentFunctions,
    }
})

const moduleDir = fromFileUrl(new URL('.', import.meta.url))
const fullDatasetPath = path.join(moduleDir, './datasets/ingredientanalyzerdataset.jsonl')
fs.writeFileSync(fullDatasetPath, finetuningData.map(data => JSON.stringify(data)).join('\n'))

console.log(`Wrote ${finetuningData.length} examples to ${fullDatasetPath}`)