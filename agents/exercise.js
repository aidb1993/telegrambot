const { GoogleGenerativeAI } = require("@google/generative-ai");

const analyzeExercise = async (exercise) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent([
    `I will provide you with a description of an exercise, and you will extract the name of the exercise and its approximate calorie count, returning the response in the following JSON format:
{ "name": "name of the exercise", "calories": "approximate calories burned by the exercise" , "duration": "duration of the exercise in minutes"}
Ensure the response always includes a valid calorie estimate based on the given exercise. If the description includes multiple exercises, focus on the main exercise or provide a combined calorie count for the described items. Example response:
{ "name": "running", "calories": "300" , "duration": "30 minutes"}
Always ensure the calorie estimate is accurate and based on standard portion sizes or typical servings always the name of the exercise in spanish.
always be specific with the calories for example if you have '300-400' calories return '350' calories.
The description is: ${exercise}
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

module.exports = { analyzeExercise };
