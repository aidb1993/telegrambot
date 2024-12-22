const { GoogleGenerativeAI } = require("@google/generative-ai");

const evaluateDay = async (meals, exercises) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  // Calculate total calories from meals and exercises
  const totalCaloriesConsumed = meals.reduce(
    (acc, meal) => acc + meal.calories,
    0
  );
  const totalCaloriesBurned = exercises.reduce(
    (acc, exercise) => acc + exercise.calories,
    0
  );
  const netCalories = totalCaloriesConsumed - totalCaloriesBurned;

  const result = await model.generateContent([
    `Como nutricionista y entrenador personal virtual, evaluaré tu día basado en tus comidas y ejercicios.

    Información del día:
    Comidas:
    ${meals
      .map((meal) => `- ${meal.meal} (${meal.calories} calorías)`)
      .join("\n")}
    
    Ejercicios:
    ${exercises
      .map(
        (exercise) =>
          `- ${exercise.exercise} (${exercise.calories} calorías quemadas, duración: ${exercise.duration} minutos)`
      )
      .join("\n")}
    
    Resumen calórico:
    - Calorías consumidas: ${totalCaloriesConsumed}
    - Calorías quemadas: ${totalCaloriesBurned}
    - Balance calórico neto: ${netCalories}

    Por favor, proporciona una evaluación detallada del día que incluya:
    1. Un análisis de las comidas y su distribución
    2. Un análisis de los ejercicios realizados y su efectividad
    3. Recomendaciones específicas para mejorar
    4. Una calificación general del día (del 1 al 10)
    5. Sugerencias para el día siguiente

    Responde en formato JSON con la siguiente estructura:
    {
      "analisisComidas": "string",
      "analisisEjercicios": "string",
      "recomendaciones": "string",
      "calificacion": number,
      "sugerenciasSiguienteDia": "string"
    }

    La respuesta debe ser específica, personalizada y motivadora, enfocada en el progreso y la mejora continua.`,
  ]);

  const cleanedResponse = result.response
    .text()
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  return JSON.parse(cleanedResponse);
};

const formatEvaluation = (evaluation) => {
  return (
    `📊 *EVALUACIÓN DEL DÍA*\n\n` +
    `🍽 *Análisis de Comidas*\n${evaluation.analisisComidas}\n\n` +
    `💪 *Análisis de Ejercicios*\n${evaluation.analisisEjercicios}\n\n` +
    `📝 *Recomendaciones*\n${evaluation.recomendaciones}\n\n` +
    `⭐ *Calificación del Día*: ${evaluation.calificacion}/10\n\n` +
    `🎯 *Sugerencias para Mañana*\n${evaluation.sugerenciasSiguienteDia}`
  );
};

module.exports = { evaluateDay, formatEvaluation };
