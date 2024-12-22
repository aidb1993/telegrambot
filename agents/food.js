const { GoogleGenerativeAI } = require("@google/generative-ai");

const analyzeFood = async (text) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent([
    `I will provide you with a description of a food or dish, and you will extract the name of the food and its approximate calorie count, returning the response in the following JSON format:
{ "name": "name of the food", "calories": "approximate calories of the food" }
Ensure the response always includes a valid calorie estimate based on the given food. If the description includes multiple foods, focus on the main dish or provide a combined calorie count for the described items. Example response:
{ "name": "salad", "calories": "100" }
Always ensure the calorie estimate is accurate and based on standard portion sizes or typical servings always the name of the food in spanish.
always be specific with the calories for example if you have '300-400' calories return '350' calories.
The description is: ${text}
`,
  ]);
  const cleanedResponse = result.response
    .text()
    .replace(/```json\n?/g, "") // Remove ```json
    .replace(/```\n?/g, "") // Remove closing ```
    .trim(); // Remove extra whitespace
  const json = JSON.parse(cleanedResponse);
  return json;
};

const formatFood = (food) => {
  return `${food.name} - ${food.calories} calories`;
};

module.exports = { analyzeFood, formatFood };
