const { GoogleGenerativeAI } = require("@google/generative-ai");

const analyzeTodo = async (text) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  // Get current date for context
  const today = new Date();
  const currentDate = today.toISOString().split("T")[0];

  const result = await model.generateContent([
    `Hoy es ${currentDate}. Como asistente de gestión de tareas, analiza el siguiente texto que describe una tarea y extrae la tarea principal y su fecha límite si se menciona.

    Reglas para el formateo:
    1. La tarea debe comenzar con un verbo en infinitivo
    2. Elimina palabras innecesarias pero mantén el contexto importante
    3. Para las fechas:
       - Entiende referencias relativas como "hoy", "mañana", "próximo [día]"
       - Convierte todas las fechas al formato YYYY-MM-DD
       - Si no hay fecha mencionada, devuelve null
       - Ten en cuenta la fecha actual proporcionada para calcular las fechas correctamente
       - Si mencionan un día de la semana, calcula la próxima ocurrencia desde hoy

    Devuelve la respuesta en formato JSON:
    {
      "task": "tarea formateada",
      "due_date": "YYYY-MM-DD o null"
    }

    Ejemplos (asumiendo que hoy es ${currentDate}):
    Entrada: "tengo que llamar al médico mañana"
    Salida: { "task": "llamar al médico", "due_date": "${
      new Date(today.getTime() + 86400000).toISOString().split("T")[0]
    }" }

    Entrada: "necesito comprar pan"
    Salida: { "task": "comprar pan", "due_date": null }

    Entrada: "recordar pagar la luz para el lunes"
    Salida: { "task": "pagar la luz", "due_date": "[fecha del próximo lunes]" }

    El texto a analizar es: ${text}`,
  ]);

  const cleanedResponse = result.response
    .text()
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  return JSON.parse(cleanedResponse);
};

const formatTodo = (todo) => {
  return `${todo.task}${todo.due_date ? ` (para: ${todo.due_date})` : ""}`;
};

module.exports = { analyzeTodo, formatTodo };
