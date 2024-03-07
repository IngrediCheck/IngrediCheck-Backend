
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fromFileUrl } from "https://deno.land/std/path/mod.ts"
import { extractorAgentSystemMessage, extractorAgentFunctions } from '../../supabase/functions/shared/llm/extractoragent_types.ts'

const trainingData = [
    [
        {
            role: 'user',
            content: `
            Go ahead and taste the goodness!
TRADER JOE'S®
ORANGE
PEACH
MANGO
100% JUICE
A BLEND OF 6 FRUIT JUICES FROM CONCENTRATE
WITH OTHER NATURAL FLAVORS & INGREDIENTS
NET 52 FL OZ (1.6 QT) 1.5L

---------------
DO NOT USEAS
NNER SEAL
BEST IF USED WITHIN 7-10 DAYS
§ SRSPENING
TRADER JOE'S®
ORANGE PEACH MANGO JUICE
No Artificial
HICH IN
Colors or Flavors
VITAMIN C
No Preservatives
100% JUICE
PASTEURIZED
Nutrition Facts
INGREDIENTS: FILTERED WATER,
ORANGE JUICE CONCENTRATE,
About 7 servings per container
APPLE JUICE CONCENTRATE,
Serving size 8 fl oz (240mL)
PINEAPPLE JUICE CONCENTRATE,
WHITE GRAPE JUICE
Amount per serving
Calories
120
CONCENTRATE, PEACH PUREE
CONCENTRATE, MANGO PUREE,
ASCORBIC ACID (VITAMIN C),
NATURAL FLAVORS, CITRIC ACID.
Saturated Fat 0g
0%
Trans Fat 0g
Cholesterol 0mg
Sodium 15mg
Total Carbohydrate 29g
Dietary Fiber 0g
0%
1%
11%
0%
Total Sugars 25g
Includes 0g Added Sugars
0%
Protein 1g
Vitamin D 0mcg
Calcium 30mg
Iron 0.5mg
Potassium 300mg
20
2%
2%
6%
Vitamin C 70mg
* The & Daily Value (DV) tells you how much a nutrient in
a serving of lood contributes to a daily diet. 2,000 calories
a day is used for general nutrition advice.
DIST. & SOLD EXCLUSIVELY BY:
TRADER JOE'S, MONROVIA, CA 91016
PERISHABLE
KEEP REFRIGERATED
GAGE RECKON
RECYCLECARTONS.COM
0066571
SKU# 66571
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: "Trader Joe's",
                        name: 'Orange Peach Mango Juice',
                        ingredients: [
                            { name: 'Filtered Water' },
                            { name: 'Orange Juice Concentrate' },
                            { name: 'Apple Juice Concentrate' },
                            { name: 'Pineapple Juice Concentrate' },
                            { name: 'White Grape Juice Concentrate' },
                            { name: 'Peach Puree Concentrate' },
                            { name: 'Mango Puree' },
                            { name: 'Ascorbic Acid (Vitamin C)' },
                            { name: 'Natural Flavors' },
                            { name: 'Citric Acid' }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            GRAIN FREE TORTILLAS
HEAT & WRAP
BURRITO SIZE
03/11
SIETE
PALEO • MOM GMO •
COUNT
PACK
GLUTEN FREE • DAIRY FREE
STORE REFRIGERATED OR FROZEN
NY930 • 138410S.
NET WT
14.9 OZ (423g)
NON
GMO
Project
VERIFIED
ect.org
GLUTEN O
FREE

---------------
Embarrassing Family Photo
The Garza Siete, circa 1994
OUR STORY
The Siete story began during the
Garza family's collective health
journey, when Veronica Garza
made a tortilla from almond flour.
Her Grandma Campos said it tasted
"even better than my homemade
tortillas," and it ensured the family
of seven (Siete!) could still enjoy
heritage-inspired meals without
sacrificing flavor or texture.
Siete continues to make delicious
Mexican-American products using
innovative and simple ingredients.
We create nourishing foods the
whole family can gather together
to enjoy because Juntos es Mejor!
Juntas
es meror
GATHER • CREATE • SHARE • ENJOY
PREPARATION
Heat pan or comal (griddle) over
medium-high heat for 2-3 minutes.
WARM TORTILLA FOR
10-15
PER
SECONDS
SIDE
STORAGE
If purchased frozen, use by printed
best by date. If purchased refrigerated,
use or freeze within 7 days.
000000000000
HOW TO BUILD &
WRAP YOUR BURRITO
1. Warm tortilla (heating instructions
above). This will help ensure it's
pliable and ready to wrap & roll.
2. Add fillings of choice.
LOOKING TO ADD FLAVOR
TO YOUR BURRITO?
TRY USING OUR TACO
SEASONING WITH YOUR
FAVORITE FILLING.
3. Fold the bottom
edge upwards to
meet the top half.
Distributed by
4. Pull tortilla
back, tucking in
the fillings.
Siete Family Foods,
Austin, TX 78731
© 2022 Siete Family Foods
hola@sietefoods.com
5. Fold the left &
@sietefoods
right edges of the
tortilla up & over
to look like an
open envelope.
6. Roll until you
have a burrito
perfecto!**
29223 BBM L1 1
Nutrition Facts
6 servings per container
Serving Size
1 tortilla (70.5 g)
Amount per serving
Calories
190
% Daily Value*
Total Fat 7g
9%
Saturated Fat 1.5g
8%
Trans Fat 0g
Cholesterol Omg
0%
Sodium 340mg
15%
Total Carbohydrate 34g
12%
Dietary Fiber 4g
14%
Total Sugars 2g
Includes 1g Added Sugars
2%
Protein 2g
Vitamin D 0mcg
0%
Calcium 30mg
2%
Iron 1.1mg
6%
Potassium 200mg
4%
•The % Daily Value tells you how much a nutrient in a
serving of food contributes to a daily diet. 2,000 calories
, a day sused for general nutrition advice.
INGREDIENTS
Water, cassava flour,
tapioca flour, avocado oil,
coconut flour, arrowroot
flour, apple cider vinegar,
coconut sugar, sea salt,
yeast.
Contains: Coconuts.
65336 00008
BURR-14.9-02-B
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'Siete',
                        name: 'Grain Free Tortillas',
                        ingredients: [
                            { name: 'Water' },
                            { name: 'Cassava Flour' },
                            { name: 'Tapioca Flour' },
                            { name: 'Avocado Oil' },
                            { name: 'Coconut Flour' },
                            { name: 'Arrowroot Flour' },
                            { name: 'Apple Cider Vinegar' },
                            { name: 'Coconut Sugar' },
                            { name: 'Sea Salt' },
                            { name: 'Yeast' }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            365
WHOLE FOODS
MARKET
Semi-Sweet
Chocolate
BAKING CHIPS
NET WT 12 OZ (340g)
42%
CACAO
FAIR TRADE
CERTIFIED*
INGREDIENTS
SARY
G SUGGESTION
-IP9

---------------
Sesam
Makes about 2
½ cup packed light brown sugar
½ cup granulated sugar
8 tablespoons (1 stick) unsalted
butter, room temperature
¼ cup tahini, stirred well
1 large egg, room temperature
2 teaspoons pure vanilla extract
Chip
1% cups whole wheat pastry flour
1 teaspoon baking soda
1 teaspoon kosher salt
2 cups 365 Semi-Sweet Chocolate
Baking Chips
2 tablespoons toasted sesame seeds
i bon again until com noduty, about a minutos. Add ole are vaniton
and beat again until combined.
in a medium bowl, whisk together flour, baking soda and salt, and then
slowly add to sugar mixture and beat until combined. Stir in baking chips
and sesame seeds just until combined. Chill until firm, 4 hours or overnight.
Preheat oven to 325°F. Drop chilled dough by rounded tablespoonful onto
parchment lined baking sheets, spacing cookies about 2 inches apart. Bake
until golden brown around the edges but still pale in the center, 9-10
minutes for smaller cookies, 10-12 minutes for larger cookies. Bake one sheet
at a time on the middle rack of the oven.
Let cool and then serve.
BEEL
Nutrition
Amount/serving
% Daily Value* Amount/serving
% Daily Value*
Total Fat 4g
• *The % Daily
5% Total Carbohydrate 10g
Facts
4% Value (DV) tells
Saturated Fat 2.5g
13%
Dietary Fiber 1g
4%
you how much
about 23 servings per container.
Trans Fat 0g
Total Sugars 8g
a nutrient in a
serving of food
Serving size
Cholesterol 0mg
0%
Includes &g Added Sugars 16%
contributes to a
1 Tbsp (15g)
Sodium 0mg
0% Protein <1g
daily diet. 2,000
calories a day is
Calories
Vitamin D 0.2mcg 0% • Calcium 3mg 0% • Iron 2mg 10%
used for general
per serving
Potassium 57 mg 0%
nutrition advice.
INGREDIENTS: CANE SUGAR*, CHOCOLATE LIQUOR*, COCOA BUTTER*,
MILKFAT, SOY LECITHIN (EMULSIFIER), VANILLA EXTRACT*.
*FAIR TRADE CERTIFIED™ BY FAIR TRADE USA 98% OF PRODUCT.
CONTAINS MILK AND SOY INGREDIENTS.
DISTRIBUTED BY:
WHOLE
WHOLE FOODS MARKET | AUSTIN, TX 78703
FOODS
©2020 WHOLE FOODS MARKET IP, LP
MARKET
www.wholefoodsmarket.com
STORE IN A COOL, DRY PLACE
sf
SODIUM FREET
*SEE NUTRITION INFORMATION FOR TOTAL FAT AND SATURATED FAT CONTENT
99482 44704
BEST BY:
03/28/25
23087-MI4
07:13
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'Whole Foods Market',
                        name: 'Semi-Sweet Chocolate Baking Chips',
                        ingredients: [
                            { name: 'Cane Sugar' },
                            { name: 'Chocolate Liquor' },
                            { name: 'Cocoa Butter' },
                            { name: 'Milkfat' },
                            { name: 'Soy Lecithin (Emulsifier)' },
                            { name: 'Vanilla Extract' }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            -BAKED WITH-
000% WHEAT
triscuit
FOUR CHEESE
& HERB
NATURAL FLAVOR WITH OTHER NATURAL FLAVOR
NO ARTIFICIAL
COLORS OR FLAVORS
PER 6 CRACKERS
120
CALORIES
SAT FAT
0% DV
115mg
SODIUM
5% DV
<1g
TOTAL
SUGARS
OD CRACKERS
ENLARGED TO SHOW DETAIL
NON
GMO
Project
VERIFIED
nongmoproject.org
NET WT 8.5 OZ (240g)
triscu
SERVING SUGGESTION

---------------
triscuit
FOUR CHEESE
& HERB
NATURAL FLAV
ITH OTHER NATURAL FLAVOR
Nutrition Facts
about 9 servings per container
Serving size 6 crackers (28g)
Amount per serving
Calories
120
% Daily Value*
Total Fat 4g
5%
Saturated Fat 0g
0%
Trans Fat 0g
Cholesterol 0mg
Sodium 115mg
Total Carbohydrate 20g
Dietary Fiber 3g
0%
5%
7%
11%
Total Sugars less than 1g
Includes less than 1g Added Sugars
1%
Protein 3g
Vitamin D 0mcg
Calcium 10mg
Iron 1.4mg
Potassium 120mg
* The % Daily Value (DV) tells you how much a
nutrient in a serving of food contributes to a
daily diet. 2,000 calories a day is used for
general nutrition advice.
0%
0%
8%
2%
INGREDIENTS: WHOLE GRAIN WHEAT, CANOLA
MALTODEXTRIN, SALT, SUGAR, ENZYME MODIFIED CHEESE
POWDERS (MONTEREY JACK CHEESE, ROMANO CHEESE
FROM COW'S MILK, PARMESAN CHEESE, CHEDDAR CHEESE
[PASTEURIZED MILK, CULTURES, SALT, ENZYMES], SALT,
CULTURES, ENZYMES), WHEY, TOMATO POWDER, CULTURED
CREAM, NATURAL FLAVOR (CONTAINS MUSTARD), DRIED
DISTILLED WHITE VINEGAR, DRIED PARSLEY, ONION POWDER,
SPICES, NONFAT MILK.
CONTAINS: WHEAT, MILK.
MONDELEZ GLOBAL LLC, EAST HANOVER, NJ 07936 USA
smartlobel™
tris
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'Triscuit',
                        name: 'Four Cheese & Herb Crackers',
                        ingredients: [
                            { name: 'Whole Grain Wheat' },
                            { name: 'Canola Oil' },
                            { name: 'Maltodextrin' },
                            { name: 'Salt' },
                            { name: 'Sugar' },
                            {
                                name: 'Enzyme Modified Cheese Powders',
                                ingredients: [
                                    { name: 'Monterey Jack Cheese' },
                                    { name: "Romano Cheese from Cow's Milk" },
                                    { name: 'Parmesan Cheese' },
                                    {
                                        name: 'Cheddar Cheese',
                                        ingredients: [
                                            { name: 'Pasteurized Milk' },
                                            { name: 'Cultures' },
                                            { name: 'Salt' },
                                            { name: 'Enzymes' },
                                        ]
                                    }
                                ]
                            },
                            { name: 'Whey' },
                            { name: 'Tomato Powder' },
                            { name: 'Cultured Cream' },
                            { name: 'Natural Flavor (Contains Mustard)' },
                            { name: 'Dried Distilled White Vinegar' },
                            { name: 'Dried Parsley' },
                            { name: 'Onion Powder' },
                            { name: 'Spices' },
                            { name: 'Nonfat Milk' }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            23 CUP
LONES
preyers
Scooping Since 192%
How Churned:
CLASSIC VANILLA
NATURAL FLAVORS
1/3 FEWER CALINE
THAN FIL AN
ICE CREAMI
NAH HE CAN
MELON ON
I HUNCH HUMONS
ON CONSAL LON
0 MOE
MAN BATH

---------------
Nutrition Facts
9 servings per container
Serving Size
2/3 Cup (79g)
Amount per serving
Calories
130
% Daily Value*
Total Fat 4g
5%
Saturated Fat 2.5g
13%
Trans Fat 0g
Cholesterol 15mg
5%
Sedium 50mg
2%
Total Carbohydrate 23g
8%
Dietary Fiber 3g
10%
Total Sugars 17g
Includes 12g Added Sugars 24%
Protein 3g
Vitarin D 0.1 mcg
Calcium 90mg
0%
Iron Org
6%
Potassium 140mg
0%
Vitamin A 60mcg
2%
6%
The % Daily Value DV tells you how much a nutrient in a
serving of food contributes to a daily diet. 2,000 calories
a day is used for general nutrition advice.
CONTAINS 4g OF FAT AND 130 CALORIES
IN FULL-FAT ICE CREAM.
COMPARED TO 13g OF FAT AND 250 CALORIES
INGREDIENTS: NON-FAT MILK, SUGAR, CREAM, CORN
SYRUP, POLYDEXTROSE, SOLUBLE CORN FIBER, WHEY,
MONO AND DIGLYCERIDES, CAROB BEAN GUM, GUAR
GUM, NATURAL. FLAVOR, INVERT SUGAR, ANATO COLOR,
VITAMIN A PALMITATE.
CONTAINS: MILK INGREDIENTS.
DISTRIBUTED BY: DREYER'S GRAND ICE CREAM, INC.
OAKLAND, CA 94618
smartlabel®
Scan here for more
food information or
call 1-866-311-6350.
KEEP FROZEN UNTIL SERVED
Available as Edy's® Slow Churned® Light Ice Cream
East of the Rockies.
**NO SIGNIFICANT DIFFERENCE HAS BEEN SHOWN BETWEEN
MILK FROM BST TREATED AND NON-IBST TREATED COWS.
41548 00186
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: "Dreyer's",
                        name: 'Slow Churned Classic Vanilla Light Ice Cream',
                        ingredients: [
                            { name: 'Non-Fat Milk' },
                            { name: 'Sugar' },
                            { name: 'Cream' },
                            { name: 'Corn Syrup' },
                            { name: 'Polydextrose' },
                            { name: 'Soluble Corn Fiber' },
                            { name: 'Whey' },
                            { name: 'Mono and Diglycerides' },
                            { name: 'Carob Bean Gum' },
                            { name: 'Guar Gum' },
                            { name: 'Natural Flavor' },
                            { name: 'Invert Sugar' },
                            { name: 'Annatto Color' },
                            { name: 'Vitamin A Palmitate' }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            SILO STREETFOOD
Thai
Garlic
Glass
Noodles
WITH VEGETABLES
READY IN
SECONDS!
SAVORY GARLICKY
SUBTLE HEAT
Meal
Kit
Serving
Suggestion
NET WT 10.48 OZ (297g)
CONTANS ONE 10.48 02 297g) SERVING

---------------
ELIS SIMPOS
10000
Nutrition Facts
1 serving per pack
Serving size 1 tray and pouch (297g)
Amount per serving
Calories
360
% Daily Value*
Total Fat 11.5g
15%
Saturated Fat 2g
10%
Trans Fat 0g
Cholesterol 0mg
0%
Sodium 800mg
35%
Total Carbohydrate 59g
21%
Dietary Fiber 8g
29%
Total Sugars 12g
Includes 9g Added Sugars
18%
Protein 6g
Vitamin D 0mcg
0%
Calcium 44mg
4%
Tron 1.6mg
8%
Potassium 247mg
6%
2he % Daily Value (DV) tells you how much a nutrient in a serving of food contributes
Caily diet. 2,000 calories a day is used for general nutrition advice.

---------------
SAVORY GARLICKY SUBTLE HEAT
Best Before: 11 APR 2024
S6N66 ABJ2 04
6g Protein • Gluten Free • BPA Free Trays
8
29354 10344
7

---------------
INGREDIENTS:
Garlic Sauce: Water, Edamame,
Garlic, Cane Sugar, Soy Sauce
(Water, Soybean, Rice, Salt),
Rice Bran Oil, Onions, Carrots,
Red Bell Peppers, Spring
Onions, Tapioca Starch, Salt,
Black Pepper, Lime Juice, Thai
Bird Chilis.
Glass Noodles: Green Mung
Bean Starch, Tapioca Starch
Potato Starch, Water,
Rice Bran Oil, Citric Acid.
CONTAINS: Soybeans.
Packed for Sun Tropics, Inc.
San Ramon, CA 94583 USA
www.suntropics.com
Product of Thailand
FOLLOW US @SUNTROPICS
Anount
Total 415%
Stures ite
Cholesterd on
Sodium 80)
Total Caroly
Delay For dy.
Toba Son thi
Prole in
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'SILO STREETFOOD',
                        name: 'Thai Garlic Glass Noodles with Vegetables',
                        ingredients: [
                            {
                                name: 'Garlic Sauce',
                                ingredients: [
                                    { name: 'Water' },
                                    { name: 'Edamame' },
                                    { name: 'Garlic' },
                                    { name: 'Cane Sugar' },
                                    {
                                        name: 'Soy Sauce',
                                        ingredients: [
                                            { name: 'Water' },
                                            { name: 'Soybean' },
                                            { name: 'Rice' },
                                            { name: 'Salt' }
                                        ]
                                    },
                                    { name: 'Rice Bran Oil' },
                                    { name: 'Onions' },
                                    { name: 'Carrots' },
                                    { name: 'Red Bell Peppers' },
                                    { name: 'Spring Onions' },
                                    { name: 'Tapioca Starch' },
                                    { name: 'Salt' },
                                    { name: 'Black Pepper' },
                                    { name: 'Lime Juice' },
                                    { name: 'Thai Bird Chilis' }
                                ]
                            },
                            {
                                name: 'Glass Noodles',
                                ingredients: [
                                    { name: 'Green Mung Bean Starch' },
                                    { name: 'Tapioca Starch' },
                                    { name: 'Potato Starch' },
                                    { name: 'Water' },
                                    { name: 'Rice Bran Oil' },
                                    { name: 'Citric Acid' }
                                ]
                            }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            GRAIN FREE TORTILLAS=
HE o SIZE
h HEAT & WRAP
SIZE --
WAAAAAAA,
-BUR RRITO
AAAAAA
AAAA
03/11
TE
SIE
A
BWAWA
• NON GM
NON GMO L
0 • GLUTEN
6
COUNT
PACK
www
ww
VEGAT
FREE. AIRY FRE
REE SOY FRÉE
• SOY FREE
E
STORE REFRIGERATED OR FROZEN
NET WT
14.90Z(423|)
NON
GM
VERIELED
nongmoproject.org
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
CERTIFIED
GLUTEN)
REE
---------------
IT90TL
PREPARATION
Heat pan or comal (griddle) over
medium-high heat for 2-3 minutes.
WARM TORTILLA FOR
10-15
SECONDS
STORAGE
If purchased frozen, use by printed
best by date. If purchased refrigerated,
use or freeze within 7 days.
HOW TO BUILD &
WRAP YOUR BURRITO
1, Warm tortilla (heating instructions
above). This will help ensure it's
pliable and ready to wrap & roll.
2. Add fillings of choice.
LOOKING TO ADD FLAVOR
TO YOUR BURRITO?
TRY USING OUR TACO
SEASONING WITH YOUR
FAVORITE FILLING.
3. Fold the bottom
edge upwards to
meet the top half.
4. Pull tortilla
the fillings.
back, tucking in
5. Fold the left &
right edges of the
tortilla up & over
to look like an
open envelope.
6. Roll until you
have a burrito
perfecto!
PER
SIDE
Nutrition Facts
6 servings per container
Serving Size
Amount per serving
Calories
Total Fat 7g
Saturated Fat 1.5g
Trans Fat Og
Cholesterol Omg
Sodium 34Omg
Total Carbohydrate 34g
Dietary Fiber 4g
Total Sugars 2g
Includes lg Added Sugars
Protein 2g
Vitamin D Omcg
Calciumn 30mg
Iron 1.lmg
Potassium 200mg
1 tortilla (70.5 g)
190
% Daily Value
9%
8%
AQ
Embarrassing Family Photo
The Garza Siete, circa 1994
OUR STORY
The Siete story began during the
Garza family's collective health
journey, when Veronica Garza
made a tortilla from almond flour.
Her Grandma Campos said it tasted
"even better than my homemade
tortillas," and it ensured the family
of seven (Siete!) could still enjoy
heritage-inspired meals without
sacrificing flavor or texture.
Siete continues to make delicious
Mexican-American products using
innovative and simple ingredients.
We create nourishing foods the
whole family can gather together
to enjoy because Juntos es Mejor!
Suntoa
Ues mejb,
O%
15%
12%
14%
2%
0%
2%
6%
4%
•The % Daily Value tells you how mucha nutrient in a
a day is used for general nutrition advice
es to a daily diet. 2,000 calories
INGREDIENTS
Water, cassava flour,
tapioca flour, avocado oil,
coconut flour, arrowroot
flour, apple cider vinegar,
cOcOnut sugar, sea salt,
yeast.
Contains CocQnuts.
Distrõuted by
Sietfamily Foods,
Austin,TX 78731
O-2022 Siefe Family Foods
hola@setefoods.com
@sietefoods
8 65336'00008'
29223 BBM L1 1
WwWWwWwwWWWWWwWWwwWWwW
WW
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'Siete Family Foods',
                        name: 'Grain Free Tortillas',
                        ingredients: [
                            { name: 'Water' },
                            { name: 'Cassava Flour' },
                            { name: 'Tapioca Flour' },
                            { name: 'Avocado Oil' },
                            { name: 'Coconut Flour' },
                            { name: 'Arrowroot Flour' },
                            { name: 'Apple Cider Vinegar' },
                            { name: 'Coconut Sugar' },
                            { name: 'Sea Salt' },
                            { name: 'Yeast' }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            d Supporter
hde Chldrenk
beh Hospftal
Nutrition Facts
About 3 1/2 servings per container
i/2 cup (127g)
Serving size
Amount per serving
Calories
Total Fat 0.5g
Saturated Fat 0g
Trans Fat 0g
Cholesterol Omg
Sodium 310mg
Total Carbohydrate 21g
Dietary Fiber <ig
Total Sugars 8g
Includes 5g Added Sugars
Protein 2g
Vit. D Omcg 0%
Iron Omg 0%
Calcium 4mg 0%
2%
Potas. 126mg
S you how much a nutrient
The % Daily Value (DV) te
Ina serving of food contributes to a daily diet. 2.000
calories a day is used for
ngredięnts: Golden Whole Kernel Corn, Wate,
general nutrition advice.
Dist. by B&G Foods, Inc.
Parsippany, NJ 07054 USA
Sugar, Moditfied Corn Starch, Salt.
© 2018 B&G Foods, Inc.
90
% Daily Value*
1%
0%
0%
13%
8%
4%
10%
PICKE
Our loveir
began oer
ago in
Minnesota
farmers sti
crop atme
PERFET
That's hov
vegetables
Thats ée
This yea, á
S3500068
Researchhy
MsSor Ail
lean mor
IWT
---------------
Green
Giant
CREAM STYLE
SWEET CORN
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'Green Giant',
                        name: 'Cream Style Sweet Corn',
                        ingredients: [
                            { name: 'Golden Whole Kernel Corn' },
                            { name: 'Water' },
                            { name: 'Sugar' },
                            { name: 'Modified Corn Starch' },
                            { name: 'Salt' },
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            Nu Trail
NUT GRANOLA
BLUEBERRY CINNAMON
SUGAR
ADDED
NOS
At NuTrail°, we meticulously craft the best high-quality,
low-sugar experiences. Enjoy the sweet crunch of our
nut granolas with more than just milk and yogurt - elevate
everything from your smoothies and baked goods, to your
ice cream. Calling it "granola" doesn't quite do NuTrail justice.
but if youre here, you either get it - or you're about to.
How to calculate net carbs per serving
SA =
-
DIETARY FIBER
(3G)
SUGAR ALCOHOL
(2G).
(4G)
TC - DF
TOTAL CARBS
(9G)
NC
NET CARBS#
For great recipes visit uS at www.nutrail.com & on social
CERTIFIED
GLUTEN
FREE
GFCO.ORG
PRODUCY,
KETO
CERIFIED
TIFL
RAIN
WFR
RESEAL AFTER OPENING. STORE IN A COOL DRY PLACE
MOTALOW CALORIE FOOD. SEE NUTRITION PANEL FOR INFORMATION ON SUGARAND CALORIE CONTENT.
Of
Nutrition Facts
About 20 servings per container
Serving size
1/3 cup (30g)
160
% Daily Value*
19%
25%
2%
1%
3%
11%
0%
Amount per serving
Calories
Total Fat 15g
Saturated Fat 5g
Trans Fat Og
Cholesterol 5mg
Sodium 25mg
Total Carbohydrate 9g
Dietary Fiber 3g
Total Sugars 2g
Includes 0g Added Sugars
Sugar Alcohol 4g
Protein 4g
Vitamin D Omcg
Calcium 30mg
Iron 1.1mg
Potassium 150mg
0%
2%
6%
4%
Daily Value tells you how much a nutrient in a
serving food contributes to a daily diet. 2,000 calories
dav is used for general nutrition advice
a
INGREDIENTS: SUNFLOWER SEEDS, PUMPKIN SEEDS, COCONUT.
AL MONDS, PECANS, ERYTHRITOL, BUTTER (PASTEURIZED
CREAM, NATURAL FLAVOR), DRIED BLUEBERRIES, CINNAMON,
SALT, MONKFRUIT EXTRACT
CONTAINS: MILK, TREE NUTS (ALMOND, COCONUT, PECAN)
PROCESSED IN A FACILITY THAT ALSO PROCESSES MILK, WHEAT,
TREE NUTS, SESAME, AND SOY.
MANUFACTURED FOR:
SNACKS GENERATION LLC
1000 BRICKELL PLAZA
MIAMI, FL33131
ITEM: 1449725
8
BEST BY: 09 21 24 12:20 10M 23263
95620227911
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'NuTrail',
                        name: 'Nut Granola Blueberry Cinnamon',
                        ingredients: [
                            { name: 'Sunflower Seeds' },
                            { name: 'Pumpkin Seeds' },
                            { name: 'Coconut' },
                            { name: 'Almonds' },
                            { name: 'Pecans' },
                            { name: 'Erythritol' },
                            {
                                name: 'Butter',
                                ingredients: [
                                    { name: 'Pasteurized Cream' },
                                    { name: 'Natural Flavor' },
                                ]
                            },
                            { name: 'Dried Blueberries' },
                            { name: 'Cinnamon' },
                            { name: 'Salt' },
                            { name: 'Monkfruit Extract' },
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `
            KIRKLAND
SINGLE PACK
CHOCOLATE
BROWNIE
10
COUNT
29
SUGAR
NET CARBS
PROTEIN
10g
|21g
10g
FIBER
KIRKLAND
21g PROTEIN
GLUTEN-FREE
MADE WITH
REAL CHOCOLATE
NO ARTIFICIAL
FLAVORS
TCHOCOLATE
BROWNIE
2g 10g 21g 10g
SUSAR CAROS OTEN
GLUTEN-FRE
MADE WITH REAL CHOCOU
NO ARTIFICIAL FLAVORS
NET WT212 0Z (60 g)
10 -2.12 0Z (60 g) BARS • NET WT 21.2 0Z (600 g)
CERTIFIED
GLUTEN
FREE
GFCO.ORG
---------------
Nutrition Facts
10 servings per container
Serving size
1 Bar (60g)
190
% Daily Value*
8%
13%
Amount per serving
Calories
Total Fat 6g
Saturated Fat 2.5g
Trans Fat 0g
Cholesterol 5mg
Sodium 140mg
Total Carbohydrate 22g
Dietary Fiber 10g
Total Sugars 2g
Includes 2g Added Sugars
Erythritol 2g
Protein 21g
Vit. D Omcg 0%
Iron 1mg 6%
INGREDIENŤS: Proteir blend (milk protein
isolate, whey protein isolate), soluble corn fiber,
cashew butter, isomalto-oligosaccharides
(vegetable source), unsweetened chocolate,
erythritol, water, cocoa butter, cocoa powder
(processed with alkali), natural flavors, sea salt,
sunflower lecithin, steviol glycosides (stevia).
CONTAINS: Milk and Cashews.
DISTRIBUTED BY:
COSTCO WHOLESALE CORPORATION
999 Lake Drive, Issaquah, WA 98027
USAWWW.COSTC0.COM
Produced in USA. Contains U.S. and imported ingredients.
ALLERGEN INFORMATION: Produced on equipment that also
processes peanuts, tree nuts, soybean, egg, wheat, sesame.
Consumers with food allergies and food sensitivities,
please read the ingredient statement carefuily.
KIRKLAND
If you're not completely satisfied with this Kirkland
Signature product, your money will be refunded.
0
l9661935611
9
2%
6%
8%
36%
4%
42%
Calcium 107mg 8%
Potassium 96mg 2%
The % Daily Value (DV) tells you how much a nutrient in
a serving of food contributes to a daily diet. 2,000 calories
a day is used for general nutrition advice.
---------------
Made with protein isolate as the
primary protein source, certified
gluten-free and only 2g of sugar, this
bar is one you can enjoy every day.
Each Kirkland SignaturęTM Protein Bar
contains 21g of protein.
10
CHOCOLATE
BROWNIE
SINGLE PACK
---------------
KIRKLAND
TT CHOCOLATE
BROWNIE
9 10g
21g
GLUTEN-FREE
MADE WITA REAL CHOCOLNTE
NO ARTIFICIAL FLAVORS
NET WT21
Natural darkening of bar color may occur over time.
Bar texture may become firmer over time.
For maximum freshness, store extra bars in
the freezer and let thaw before eating.
            `
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'Kirkland Signature',
                        name: 'Chocolate Brownie Protein Bar',
                        ingredients: [
                            {
                                name: 'Protein blend',
                                ingredients: [
                                    { name: 'milk protein isolate' },
                                    { name: 'whey protein isolate' },
                                ]
                            },
                            { name: 'Soluble corn fiber' },
                            { name: 'Cashew butter' },
                            { name: 'Isomalto-oligosaccharides (vegetable source)' },
                            { name: 'Unsweetened chocolate' },
                            { name: 'Erythritol' },
                            { name: 'Water' },
                            { name: 'Cocoa butter' },
                            { name: 'Cocoa powder (processed with alkali)' },
                            { name: 'Natural flavors' },
                            { name: 'Sea salt' },
                            { name: 'Sunflower lecithin' },
                            { name: 'Steviol glycosides (stevia)' }
                        ]
                    }
                })
            }
        }
    ],
    [
        {
            role: 'user',
            content: `TEAR HERE\nCHEESE -\nKEEP REFRIGERATED\nNATURAL\nWHOI LE MILK\nMOZZARELLA\nLOW MOISTURE\nSHREDDED CHEESE\nCUT STRAIGHT FROM THE BLOCK\nmoi ovomeA\ntel yns etsiagihtef\neolboon sgsesl Si\n(bašoos)\nPS pm0d mbi\nsni Inentun s roum wod\neeholso 000,S Joiby\nTIA2\nFROM COWS\nTH MILK\nNO\nPBST\nMADE WITH\nNoT TREAY\nHITH BST\nGOOD\nSOURCE OF\nCALCIUM\nSEE NUTRITION\nNFORMATION FOR\nSATURATED\nFAT CONTENT\nUD SIGNIFICANT DIFFERENCE HAS BEEN\nSNOWW BETWEEN MILK DERIVED FROM\nTBST-TREATED AND WON- BSTTREATED COWS.\nHOTAHMCJON\nJLIIN\n0 FEOFDN IHT YA\nEST F EET SISC OHO\nRH4 27-636\nSHVE9O AETRA Y\n3U mss2,noitsnatnl foy\nCOEA-Sio-0G8 lisð 10 ga\nNET WT& 0Z (226g)\n20\nCUPS\n---------------\nNutrition Facts\nServing size\n1/4 cup (28g)\nabout 8 servings per container\nAmount per serving\nCaloriees\nTotal Fat 7g\nSaturated Fat 4.5g\nTrans Fat Og\nCholesterol 25mg\nSodium 170mg\nTotal Carbohydrate 1g\nDietary Fiber Og\nTotal Sugars Og\nIncludes Og Added Sugars\nProtein 6g\nVitamin D Omcg 0%\nCalcium 160mg 10%\nPotassium 50mg 2%\nIron Omg 0%\n\"The % Daily Value tels you how much a nutrient in a\nserving of food contributes to a daily diet. 2,000 calories\na day is used for general nutrition advice.\nINGREDIENTS: PASTEURIZED MILK, CHEESE CULTURE, SALT\nENZYMES, POTATO STARCH, TAPIO0CÃ STARCH,. DEXTROSE AND\nCALCIUM SULFATE (ADDED TO PREVENT CAKING), NATAMYCIN\n(A NATURAL MOLD INHIBITOR).\nCONTAINS: MILK.\nDISTRIBUTED BY THE KROGER CO.\nCINCINNATI, OHIO 45202\nFOR BEST QUALITY KEEP REFRIGERATED AND CONSUME\nWITHIN 3 T05 DAYS AFTER OPENING.\nFor More Product Information, Scan UPC\nUsing Your Kroger App or Call 800-632-6900\nOur Brands. Our Guarantee.\nLove It or Your Money Back.\nwww.kroger,com\n•\n90\n% Daily Value*\n9%\n22%\n8%\n7%\n0%\n0%\n0%\nKroger)\nog\nCHEESE\n-NATURAL\nThy This\nRoope!\nCLASSIC\nVEGETARIAN LASAGNA\nINGREDIENTS\n24 oz Jarred\nmarinara sauce\n2C ricotta cheese\nI egg\nI/4 C shredded\nParmesan cheese\ni/4 tsp salt\nI tsp black pepper\n2C shredded whole\nmilk mozzarella\ncheese\n12 lasagna noodles\n(cooked)\nDIRECTIONS\nI Preheat oven to 350°F.\n2. Spray a 13\"x 9\" baking dish with nonstick spray.\n3. Spread 2 tablespoons of marinara on bottom of pan.\n4. In a large mixing bowl blend together ricotta\ncheese, egg, and Parmesan cheese, salt and pepper.\n5. In baking dish place 4 lasagna sheets slightly\noverlapping. Place about |/3 of the mixture on\nnoodles and sprinkle l/2 cup of mozzarella shreds\nand about I/2 cup of marinara. Repeat twice. Place\nlast layer of noodles and finish with the rest of the\nmarinara and top with remaining mozzarella shreds.\n6. Bake for 40 minutes or until hot and bubbly.\nRemove from oven. Let rest for 10 minutes & enjoy!\nRefrigerate any leftovers. Serves 8."`
        },
        {
            role: 'assistant',
            function_call: {
                name: 'record_product_details',
                arguments: JSON.stringify({
                    product: {
                        brand: 'Kroger',
                        name: 'Whole Milk Mozzarella Low Moisture Shredded Cheese',
                        ingredients: [
                            { name: 'Pasteurized Milk' },
                            { name: 'Cheese Culture' },
                            { name: 'Salt' },
                            { name: 'Enzymes' },
                            { name: 'Potato Starch' },
                            { name: 'Tapioca Starch' },
                            { name: 'Dextrose and Calcium Sulfate (Added to prevent caking)' },
                            { name: 'Natamycin (A natural mold inhibitor)' }
                        ]
                    }
                })
            }
        }
    ]
]

const finetuningData = trainingData.map((messages: any) => {
    messages.unshift({
        role: 'system',
        content: extractorAgentSystemMessage
    })
    return {
        messages: messages,
        functions: extractorAgentFunctions,
    }
})

const moduleDir = fromFileUrl(new URL('.', import.meta.url))
const fullDatasetPath = path.join(moduleDir, './datasets/extractordataset.jsonl')
fs.writeFileSync(fullDatasetPath, finetuningData.map(data => JSON.stringify(data)).join('\n'))

console.log(`Wrote ${finetuningData.length} examples to ${fullDatasetPath}`)