require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const { promisify } = require("util");
const { handleMessage, initChatSession } = require("./model.js");
const {
  GoogleAIFileManager,
  FileState,
} = require("@google/generative-ai/server");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const os = require("os");
const path = require("path");
const { analyzeFood } = require("./agents/food.js");
const { analyzeExercise } = require("./agents/exercise.js");
const { evaluateDay, formatEvaluation } = require("./agents/evaluator.js");
const { analyzeTodo, formatTodo } = require("./agents/todo.js");

// Set up Telegram and OpenAI clients
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GEMINI_API_KEY) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const bot = new Telegraf("7767185269:AAHM5AWsxgOj6BoL7wteQEXXcY-TqX1Xd7Y");

// Set up SQLite database with better error handling
const db = new sqlite3.Database("./tracker.db", (err) => {
  if (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  }
  console.log("Connected to database successfully");
});

// Promisify database operations
const dbRun = promisify(db.run.bind(db));
const dbAll = promisify(db.all.bind(db));

// Create tables for exercises and meals
async function initializeDatabase() {
  try {
    await dbRun(
      "CREATE TABLE IF NOT EXISTS meals (id INTEGER PRIMARY KEY, date TEXT, meal TEXT, calories INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    );
    await dbRun(
      "CREATE TABLE IF NOT EXISTS exercises (id INTEGER PRIMARY KEY, date TEXT, exercise TEXT, duration INTEGER, calories INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    );
    await dbRun(
      "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, task TEXT, completed BOOLEAN DEFAULT 0, due_date TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    );
    console.log("Database tables initialized successfully");
  } catch (error) {
    console.error("Database initialization error:", error);
    process.exit(1);
  }
}

// Function to process voice notes with Whisper
async function transcribeVoice(fileId) {
  let uploadedFileName = null;
  let fileManager = null;
  try {
    // Get file from Telegram
    const fileResponse = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    );

    if (!fileResponse.data.ok) {
      throw new Error("Failed to get file information from Telegram");
    }

    const filePath = fileResponse.data.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    // Download the audio file
    const audioData = await axios.get(fileUrl, { responseType: "arraybuffer" });

    // Initialize Google AI services
    fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    // Create a temporary file path using os.tmpdir()
    const tempFilePath = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);
    await require("fs").promises.writeFile(
      tempFilePath,
      Buffer.from(audioData.data)
    );

    // Upload file to Google AI
    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: "audio/ogg",
      displayName: `Voice Message ${Date.now()}`,
    });
    uploadedFileName = uploadResult.file.name;

    // Wait for processing
    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === FileState.PROCESSING) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds between checks
      file = await fileManager.getFile(uploadResult.file.name);
    }

    if (file.state === FileState.FAILED) {
      throw new Error("Audio processing failed");
    }

    // Get transcription using Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([
      "Transcribe this audio clip and return the transcribed text. also try to understand the context of the audio and return the context in the response it can be a meal, exercise, or todo. If it's a meal return the name of the food and the calories, if it's an exercise return the name of the exercise, calories burned and duration, if it's a todo return the task and due date if mentioned. The response should be in json format like this: {text: 'transcribed text', context: {type: 'meal' or 'exercise' or 'todo', name: 'name of the food/exercise/task', calories: 'calories of the food or calories burned by the exercise', duration: 'duration of the exercise in minutes', due_date: 'due date for todo if mentioned'}} example: {text: 'I had a salad with lettuce, tomato, and cucumber', context: {type: 'meal', name: 'salad', calories: '100'}} example: {text: 'I went for a run for 30 minutes', context: {type: 'exercise', name: 'run', calories: '300' , duration: '30'}} example: {text: 'recordar comprar leche para mañana', context: {type: 'todo', name: 'comprar leche', due_date: 'mañana'}} if the text is not clear or not understandable return the response in json format like this: {text: 'transcribed text', context: {type: 'unknown', name: 'unknown', calories: 'unknown' , duration: 'unknown'}}",
      {
        fileData: {
          fileUri: uploadResult.file.uri,
          mimeType: uploadResult.file.mimeType,
        },
      },
    ]);

    // Clean the response by removing markdown formatting
    const cleanedResponse = result.response
      .text()
      .replace(/```json\n?/g, "") // Remove ```json
      .replace(/```\n?/g, "") // Remove closing ```
      .trim(); // Remove extra whitespace

    const json = JSON.parse(cleanedResponse);

    let food = null;
    let exercise = null;

    if (json.context.type === "meal" && json.context.calories === "unknown") {
      food = await analyzeFood(json.text);
    } else {
      food = json;
    }

    if (
      json.context.type === "exercise" &&
      json.context.calories === "unknown"
    ) {
      exercise = await analyzeExercise(json.text);
    } else {
      exercise = json;
    }

    // Clean up temporary file
    await require("fs").promises.unlink(tempFilePath);

    // Delete the uploaded file from Google AI
    if (uploadedFileName) {
      await fileManager.deleteFile(uploadedFileName);
      console.log(`Deleted uploaded file: ${uploadResult.file.displayName}`);
    }

    if (json.context.type === "todo") {
      const analyzedTodo = await analyzeTodo(json.text);
      await saveTodo(analyzedTodo.task, analyzedTodo.due_date);
      return {
        text: json.text,
        context: {
          type: "todo",
          task: analyzedTodo.task,
          due_date: analyzedTodo.due_date,
        },
      };
    }

    if (json.context.type === "exercise") {
      return {
        text: json.text,
        context: {
          type: "exercise",
          name: exercise.name,
          calories: exercise.calories,
          duration: exercise.duration,
        },
      };
    }

    if (json.context.type === "meal") {
      return {
        text: json.text,
        context: {
          type: "meal",
          name: food.name,
          calories: food.calories,
        },
      };
    }

    return json;
  } catch (error) {
    // Make sure to clean up even if there's an error
    if (uploadedFileName && fileManager) {
      try {
        await fileManager.deleteFile(uploadedFileName);
        console.log(`Deleted uploaded file after error: ${uploadedFileName}`);
      } catch (deleteError) {
        console.error("Error deleting uploaded file:", deleteError);
      }
    }
    console.error("Transcription error:", error);
    throw new Error("Failed to transcribe voice message");
  }
}

// Improved function to classify text as meal or exercise
async function classifyText(text) {
  try {
    const prompt = `Please classify the following text as either "meal" or "exercise". 
    If it's about food, eating, or consumption, classify as "meal".
    If it's about physical activity, workout, or movement, classify as "exercise".
    
    Text: "${text}"
    Classification:`;

    const response = await openai.completions.create({
      model: "text-davinci-003",
      prompt: prompt,
      max_tokens: 10,
      temperature: 0.3,
    });

    const classification = response.choices[0].text.trim().toLowerCase();
    if (!["meal", "exercise"].includes(classification)) {
      throw new Error("Invalid classification result");
    }
    return classification;
  } catch (error) {
    console.error("Classification error:", error);
    throw new Error("Failed to classify text");
  }
}

// Save data to the database with better error handling
async function saveMeal(date, meal, calories) {
  try {
    await dbRun("INSERT INTO meals (date, meal, calories) VALUES (?, ?, ?)", [
      date,
      meal,
      calories || null,
    ]);
    console.log("Meal saved successfully:", { date, meal, calories });
  } catch (error) {
    console.error("Error saving meal:", error);
    throw new Error("Failed to save meal to database");
  }
}

async function saveExercise(date, exercise, duration, calories) {
  try {
    await dbRun(
      "INSERT INTO exercises (date, exercise, duration, calories) VALUES (?, ?, ?, ?)",
      [date, exercise, duration || null, calories || null]
    );
    console.log("Exercise saved successfully:", {
      date,
      exercise,
      duration,
      calories,
    });
  } catch (error) {
    console.error("Error saving exercise:", error);
    throw new Error("Failed to save exercise to database");
  }
}

// Save data to the database with better error handling
async function saveTodo(task, dueDate = null) {
  try {
    await dbRun("INSERT INTO todos (task, due_date) VALUES (?, ?)", [
      task,
      dueDate,
    ]);
    console.log("Todo saved successfully:", { task, dueDate });
  } catch (error) {
    console.error("Error saving todo:", error);
    throw new Error("Failed to save todo to database");
  }
}

async function toggleTodo(id) {
  try {
    await dbRun("UPDATE todos SET completed = NOT completed WHERE id = ?", [
      id,
    ]);
    console.log("Todo toggled successfully:", { id });
  } catch (error) {
    console.error("Error toggling todo:", error);
    throw new Error("Failed to toggle todo in database");
  }
}

async function deleteTodo(id) {
  try {
    await dbRun("DELETE FROM todos WHERE id = ?", [id]);
    console.log("Todo deleted successfully:", { id });
  } catch (error) {
    console.error("Error deleting todo:", error);
    throw new Error("Failed to delete todo from database");
  }
}

// Handle voice messages with better error handling
bot.on("voice", async (ctx) => {
  try {
    const voice = ctx.message.voice;
    await ctx.reply("Procesando tu nota de voz...");

    const result = await transcribeVoice(voice.file_id);
    console.log(result);
    if (!result) {
      throw new Error("Empty transcription result");
    }

    if (result.context.type === "unknown") {
      await ctx.reply(
        "Lo siento, no pude entender el mensaje. Por favor intenta nuevamente."
      );
      return;
    }

    if (result.context.type === "todo") {
      await ctx.reply(
        `✅ Tarea agregada:\n*${result.context.task}*${
          result.context.due_date
            ? `\nFecha límite: ${result.context.due_date}`
            : ""
        }`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (result.context.type === "exercise") {
      await saveExercise(
        new Date().toISOString().split("T")[0],
        result.context.name,
        parseInt(result.context.duration.replace("minutes", "").trim()),
        parseInt(result.context.calories)
      );
      await ctx.reply(
        `✅ Registré tu ejercicio:\n*${result.context.name}* - ${result.context.calories} calorías quemadas (${result.context.duration} minutos)`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await saveMeal(
      new Date().toISOString().split("T")[0],
      result.context.name,
      parseInt(result.context.calories)
    );
    await ctx.reply(
      `✅ Registré tu comida:\n*${result.context.name}* - ${result.context.calories} calorías`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Voice message processing error:", error);
    await ctx.reply(
      "Lo siento, hubo un error procesando tu mensaje. Por favor intenta nuevamente."
    );
  }
});

bot.on("message", async (ctx) => {
  try {
    // Handle text messages
    if (ctx.message.text) {
      // Check for the command /mealplan
      if (ctx.message.text.toLowerCase() === "/mealplan") {
        await ctx.reply("Generando plan de alimentación personalizado...");
        const chatSession = initChatSession();

        const response = await handleMessage(
          "plan de alimentación",
          chatSession
        );
        await ctx.reply(response);
        return;
      }

      if (ctx.message.text.toLowerCase() === "/exerciseplan") {
        await ctx.reply("Generando plan de ejercicio personalizado...");
        const chatSession = initChatSession();
        const response = await handleMessage("plan de ejercicio", chatSession);
        await ctx.reply(response);
        return;
      }

      if (ctx.message.text.toLowerCase() === "/allmymeals") {
        await ctx.reply("📋 Cargando tu historial de comidas...");
        const meals = await dbAll("SELECT * FROM meals ORDER BY date DESC");

        if (meals.length === 0) {
          await ctx.reply("❌ No hay comidas registradas todavía.");
          return;
        }

        let message = "️ *Tu Historial de Comidas*\n\n";
        let currentDate = "";

        for (const meal of meals) {
          const mealDate = new Date(meal.date).toLocaleDateString("es-AR", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          if (currentDate !== mealDate) {
            currentDate = mealDate;
            message += `📅 *${mealDate}*\n`;
          }

          message += `  • ${meal.meal} — ${meal.calories} kcal 🔥\n`;
        }

        await ctx.reply(message, { parse_mode: "Markdown" });
        return;
      }

      if (ctx.message.text.toLowerCase() === "/allexercises") {
        await ctx.reply("📋 Cargando tu historial de ejercicios...");
        const exercises = await dbAll(
          "SELECT * FROM exercises ORDER BY date DESC"
        );

        if (exercises.length === 0) {
          await ctx.reply("❌ No hay ejercicios registrados todavía.");
          return;
        }

        let message = "🏃‍♂️ *Tu Historial de Ejercicios*\n\n";
        let currentDate = "";

        for (const exercise of exercises) {
          const exerciseDate = new Date(exercise.date).toLocaleDateString(
            "es-AR",
            {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }
          );

          if (currentDate !== exerciseDate) {
            currentDate = exerciseDate;
            message += `📅 *${exerciseDate}*\n`;
          }

          let details = `  • ${exercise.exercise}`;
          if (exercise.duration) {
            details += ` (${exercise.duration} min)`;
          }
          details += ` — ${exercise.calories} kcal 🔥\n`;
          message += details;
        }

        await ctx.reply(message, { parse_mode: "Markdown" });
        return;
      }

      if (ctx.message.text.toLowerCase() === "/evaluateday") {
        await ctx.reply("📊 Analizando tu día...");

        try {
          // Get today's date in YYYY-MM-DD format
          const today = new Date().toISOString().split("T")[0];

          // Get today's meals and exercises
          const meals = await dbAll(
            "SELECT * FROM meals WHERE date = ? ORDER BY created_at ASC",
            [today]
          );

          const exercises = await dbAll(
            "SELECT * FROM exercises WHERE date = ? ORDER BY created_at ASC",
            [today]
          );

          if (meals.length === 0 && exercises.length === 0) {
            await ctx.reply(
              "❌ No hay registros de comidas ni ejercicios para el día de hoy."
            );
            return;
          }

          // Evaluate the day
          const evaluation = await evaluateDay(meals, exercises);
          const formattedEvaluation = formatEvaluation(evaluation);

          await ctx.reply(formattedEvaluation, { parse_mode: "Markdown" });
        } catch (error) {
          console.error("Error evaluating day:", error);
          await ctx.reply(
            "Lo siento, hubo un error al evaluar tu día. Por favor intenta nuevamente."
          );
        }
        return;
      }

      // Add meal command handler
      if (ctx.message.text.toLowerCase() === "/addmeal") {
        await ctx.reply(
          "🍽 ¿Qué comiste? Describe tu comida lo más detallado posible.\n" +
            "Por ejemplo: 'milanesa con puré' o 'ensalada de lechuga, tomate y zanahoria'",
          { reply_markup: { force_reply: true } }
        );
        return;
      }

      // Add exercise command handler
      if (ctx.message.text.toLowerCase() === "/addexercise") {
        await ctx.reply(
          "💪 ¿Qué ejercicio realizaste? Incluye el tiempo si es posible.\n" +
            "Por ejemplo: '30 minutos de caminata' o 'una hora de gimnasio'",
          { reply_markup: { force_reply: true } }
        );
        return;
      }

      // Add todo command handlers in the message handler
      if (ctx.message.text.toLowerCase() === "/addtodo") {
        await ctx.reply(
          "📝 ¿Qué tarea quieres agregar?\n" +
            "Puedes incluir una fecha límite agregando 'para [fecha]' al final.\n" +
            "Por ejemplo: 'Llamar al médico para mañana' o 'Comprar verduras para el viernes'",
          { reply_markup: { force_reply: true } }
        );
        return;
      }

      if (ctx.message.text.toLowerCase() === "/todos") {
        await ctx.reply("📋 Cargando tu lista de tareas...");
        const todos = await dbAll(
          "SELECT * FROM todos ORDER BY due_date ASC, completed ASC, created_at DESC"
        );

        if (todos.length === 0) {
          await ctx.reply("✨ No hay tareas pendientes.");
          return;
        }

        // Group tasks by date
        const tasksByDate = {};
        const overdueTasks = [];
        const noDateTasks = [];
        const completedTasks = [];

        // Set timezone to Argentina (UTC-3)
        const today = new Date();
        today.setHours(today.getHours() - 3); // Adjust to Argentina timezone
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split("T")[0];

        todos.forEach((todo) => {
          if (todo.completed) {
            completedTasks.push(todo);
            return;
          }

          if (!todo.due_date) {
            noDateTasks.push(todo);
            return;
          }

          // Adjust due date to Argentina timezone
          const dueDate = new Date(todo.due_date + "T00:00:00-03:00");

          if (dueDate < today) {
            overdueTasks.push(todo);
            return;
          }

          if (!tasksByDate[todo.due_date]) {
            tasksByDate[todo.due_date] = [];
          }
          tasksByDate[todo.due_date].push(todo);
        });

        let message = "📝 *LISTA DE TAREAS*\n\n";

        // Format overdue tasks
        if (overdueTasks.length > 0) {
          message += "⚠️ *Tareas Vencidas:*\n";
          overdueTasks.forEach((todo) => {
            const dueDate = new Date(todo.due_date + "T00:00:00-03:00");
            const formattedDate = dueDate.toLocaleDateString("es-AR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            });
            message += `❗️ \`/done_${todo.id}\` ${todo.task} _(vencida: ${formattedDate})_\n`;
          });
          message += "\n";
        }

        // Format tasks by date
        const dateEntries = Object.entries(tasksByDate).sort(([a], [b]) =>
          a.localeCompare(b)
        );
        if (dateEntries.length > 0) {
          message += "📅 *Próximas Tareas:*\n";
          dateEntries.forEach(([date, tasks]) => {
            const dueDate = new Date(date + "T00:00:00-03:00");
            const formattedDate = dueDate.toLocaleDateString("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            });

            if (date === todayStr) {
              message += `\n🎯 *HOY - ${formattedDate}*\n`;
            } else {
              const diffTime = Math.abs(dueDate.getTime() - today.getTime());
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              const daysText =
                diffDays === 1 ? "mañana" : `en ${diffDays} días`;
              message += `\n📌 *${formattedDate}* _(${daysText})_\n`;
            }

            tasks.forEach((todo) => {
              message += `• \`/done_${todo.id}\` ${todo.task}\n`;
            });
          });
          message += "\n";
        }

        // Format tasks without due date
        if (noDateTasks.length > 0) {
          message += "📌 *Tareas Sin Fecha:*\n";
          noDateTasks.forEach((todo) => {
            message += `• \`/done_${todo.id}\` ${todo.task}\n`;
          });
          message += "\n";
        }

        // Format completed tasks
        if (completedTasks.length > 0) {
          message += "✅ *Tareas Completadas:*\n";
          const recentCompletedTasks = completedTasks.slice(0, 5); // Show only last 5 completed tasks
          recentCompletedTasks.forEach((todo) => {
            const completedDate = new Date(todo.created_at);
            completedDate.setHours(completedDate.getHours() - 3); // Adjust to Argentina timezone
            const formattedDate = completedDate.toLocaleDateString("es-AR", {
              day: "numeric",
              month: "short",
              year: "numeric",
            });
            message += `✓ ${todo.task} _(${formattedDate})_\n`;
          });

          if (completedTasks.length > 5) {
            message += `_...y ${completedTasks.length - 5} tareas más..._\n`;
          }
        }

        message += "\n💡 *Acciones:*\n";
        message += "• Usa `/addtodo` para agregar una tarea\n";
        message += "• Usa `/done_X` para completar una tarea\n";
        message += "• Usa `/delete_X` para eliminar una tarea";

        await ctx.reply(message, { parse_mode: "Markdown" });
        return;
      }

      // Handle done and delete commands
      if (ctx.message.text.toLowerCase().startsWith("/done_")) {
        const todoId = parseInt(ctx.message.text.slice(6));
        if (isNaN(todoId)) {
          await ctx.reply("❌ ID de tarea inválido");
          return;
        }
        try {
          await toggleTodo(todoId);
          await ctx.reply("✅ ¡Tarea marcada como completada!");
        } catch (error) {
          await ctx.reply("❌ Error al actualizar la tarea");
        }
        return;
      }

      if (ctx.message.text.toLowerCase().startsWith("/delete_")) {
        const todoId = parseInt(ctx.message.text.slice(8));
        if (isNaN(todoId)) {
          await ctx.reply("❌ ID de tarea inválido");
          return;
        }
        try {
          await deleteTodo(todoId);
          await ctx.reply("🗑️ Tarea eliminada");
        } catch (error) {
          await ctx.reply("❌ Error al eliminar la tarea");
        }
        return;
      }

      // Handle replies to the prompts
      if (
        ctx.message.reply_to_message &&
        ctx.message.reply_to_message.from.is_bot
      ) {
        const promptMessage = ctx.message.reply_to_message.text;

        // Handle meal reply
        if (promptMessage.includes("¿Qué comiste?")) {
          try {
            const food = await analyzeFood(ctx.message.text);
            await saveMeal(
              new Date().toISOString().split("T")[0],
              food.name,
              parseInt(food.calories)
            );
            await ctx.reply(
              `✅ Registré tu comida:\n*${food.name}* - ${food.calories} calorías`,
              { parse_mode: "Markdown" }
            );
          } catch (error) {
            console.error("Error adding meal:", error);
            await ctx.reply(
              "❌ Hubo un error al registrar la comida. Por favor intenta nuevamente."
            );
          }
          return;
        }

        // Handle exercise reply
        if (promptMessage.includes("¿Qué ejercicio realizaste?")) {
          try {
            const exercise = await analyzeExercise(ctx.message.text);
            await saveExercise(
              new Date().toISOString().split("T")[0],
              exercise.name,
              parseInt(exercise.duration),
              parseInt(exercise.calories)
            );
            await ctx.reply(
              `✅ Registré tu ejercicio:\n*${exercise.name}* - ${exercise.calories} calorías quemadas (${exercise.duration} minutos)`,
              { parse_mode: "Markdown" }
            );
          } catch (error) {
            console.error("Error adding exercise:", error);
            await ctx.reply(
              "❌ Hubo un error al registrar el ejercicio. Por favor intenta nuevamente."
            );
          }
          return;
        }

        // Handle todo reply
        if (promptMessage.includes("¿Qué tarea quieres agregar?")) {
          try {
            const analyzedTodo = await analyzeTodo(ctx.message.text);
            await saveTodo(analyzedTodo.task, analyzedTodo.due_date);
            await ctx.reply(
              `✅ Tarea agregada:\n*${analyzedTodo.task}*${
                analyzedTodo.due_date
                  ? `\nFecha límite: ${analyzedTodo.due_date}`
                  : ""
              }`,
              { parse_mode: "Markdown" }
            );
          } catch (error) {
            console.error("Error adding todo:", error);
            await ctx.reply(
              "❌ Hubo un error al agregar la tarea. Por favor intenta nuevamente."
            );
          }
          return;
        }
      }

      // Only show the default help message if it's not a command or a reply
      if (!ctx.message.text.startsWith("/") && !ctx.message.reply_to_message) {
        console.log("Received message:", ctx.message.text);
        await ctx.reply(
          "👋 ¡Hola! Usa /help para ver todos los comandos disponibles."
        );
        return;
      }

      // Add help command to show available commands
      if (ctx.message.text.toLowerCase() === "/help") {
        const helpMessage =
          `🤖 *Comandos Disponibles*\n\n` +
          `📝 *Registro de Actividades*\n` +
          `/addmeal - Registrar una comida\n` +
          `/addexercise - Registrar un ejercicio\n` +
          `/addtodo - Agregar una tarea\n\n` +
          `📊 *Análisis y Reportes*\n` +
          `/evaluateday - Evaluar el día actual\n` +
          `/allmymeals - Ver historial de comidas\n` +
          `/allexercises - Ver historial de ejercicios\n` +
          `/todos - Ver lista de tareas\n\n` +
          `📋 *Planes*\n` +
          `/mealplan - Generar plan de alimentación\n` +
          `/exerciseplan - Generar plan de ejercicios\n\n` +
          `💡 *Tips*:\n` +
          `• Puedes enviar notas de voz describiendo tus comidas, ejercicios o tareas\n` +
          `• Al agregar una tarea, puedes incluir una fecha límite usando 'para [fecha]'\n` +
          `• Usa /done_X para marcar una tarea como completada\n` +
          `• Usa /delete_X para eliminar una tarea`;

        await ctx.reply(helpMessage, { parse_mode: "Markdown" });
        return;
      }
    }
  } catch (error) {
    console.error("Message handling error:", error);
    await ctx.reply(
      "Lo siento, hubo un error procesando tu mensaje. Por favor intenta nuevamente."
    );
  }
});

// Initialize database and start the bot
async function startBot() {
  try {
    await initializeDatabase();
    await bot.launch();
    console.log("Bot is running...");

    // Enable graceful stop
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  } catch (error) {
    console.error("Failed to start bot:", error);
    process.exit(1);
  }
}

startBot();
