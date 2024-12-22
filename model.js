const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable");
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-8b",
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

const initChatSession = () => {
  return model.startChat({
    generationConfig,
    history: [],
  });
};

async function generateMealPlan(chatSession) {
  const structuredPrompt = `Generate a weekly meal plan for a 31-year-old man, height 1.70m, weight 84kg, who wants to lose weight and gain muscle. The diet should provide 1,800-2,000 daily calories, exclude fish, and include one controlled cheat meal on weekend. Use accessible Argentine foods.

Please provide the response in the following JSON format, without any markdown formatting or code blocks and in argentinian spanish and use products that are available in Argentina and are not expensive:
{
  "weeklyCalories": number,
  "dailyProteinGrams": number,
  "recommendations": string[],
  "mealPlan": {
    "monday": { "breakfast": string, "lunch": string, "snack": string, "dinner": string },
    "tuesday": { "breakfast": string, "lunch": string, "snack": string, "dinner": string },
    "wednesday": { "breakfast": string, "lunch": string, "snack": string, "dinner": string },
    "thursday": { "breakfast": string, "lunch": string, "snack": string, "dinner": string },
    "friday": { "breakfast": string, "lunch": string, "snack": string, "dinner": string },
    "saturday": { "breakfast": string, "lunch": string, "snack": string, "dinner": string },
    "sunday": { "breakfast": string, "lunch": string, "snack": string, "dinner": string }
  }
}`;

  try {
    const result = await chatSession.sendMessage(structuredPrompt);
    const responseText = result.response.text();

    // Clean the response by removing markdown formatting
    const cleanedResponse = responseText
      .replace(/```json\n?/g, "") // Remove ```json
      .replace(/```\n?/g, "") // Remove closing ```
      .trim(); // Remove extra whitespace

    const mealPlanData = JSON.parse(cleanedResponse);

    // Format the response for Telegram
    const formattedResponse = formatMealPlanResponse(mealPlanData);
    return formattedResponse;
  } catch (error) {
    console.error("Error generating meal plan:", error);
    return "Lo siento, hubo un error generando el plan de alimentación. Por favor intenta nuevamente.";
  }
}

function formatMealPlanResponse(mealPlanData) {
  const days = {
    monday: "Lunes",
    tuesday: "Martes",
    wednesday: "Miércoles",
    thursday: "Jueves",
    friday: "Viernes",
    saturday: "Sábado",
    sunday: "Domingo",
  };

  let response = `🍽 PLAN DE ALIMENTACIÓN SEMANAL\n\n`;
  response += `📊 Calorías semanales: ${mealPlanData.weeklyCalories}\n`;
  response += `💪 Proteína diaria: ${mealPlanData.dailyProteinGrams}g\n\n`;

  response += `📝 RECOMENDACIONES:\n`;
  mealPlanData.recommendations.forEach((rec) => {
    response += `• ${rec}\n`;
  });
  response += "\n";

  for (const [day, meals] of Object.entries(mealPlanData.mealPlan)) {
    response += `📅 ${days[day].toUpperCase()}\n`;
    response += `🌅 Desayuno: ${meals.breakfast}\n`;
    response += `🍳 Almuerzo: ${meals.lunch}\n`;
    response += `🥪 Merienda: ${meals.snack}\n`;
    response += `🌙 Cena: ${meals.dinner}\n\n`;
  }

  response += `\n⚠️ Importante: Este plan es una guía general. Consulta con un profesional de la salud antes de comenzar cualquier dieta.`;

  return response;
}

async function handleMessage(message, chatSession) {
  // Check if message is requesting a meal plan
  if (
    message.toLowerCase().includes("plan de alimentación") ||
    message.toLowerCase().includes("dieta") ||
    message.toLowerCase().includes("plan alimenticio")
  ) {
    return await generateMealPlan(chatSession);
  }

  // Handle other types of messages
  const result = await chatSession.sendMessage(message);
  return result.response.text();
}

module.exports = {
  handleMessage,
  model,
  generationConfig,
  initChatSession,
};
