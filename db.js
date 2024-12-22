const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("Missing Supabase environment variables");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function initializeDatabase() {
  console.log("Database initialized successfully");
}

async function saveMeal(date, meal, calories) {
  try {
    const { data, error } = await supabase
      .from("meals")
      .insert([{ date, meal, calories }]);

    if (error) throw error;
    console.log("Meal saved successfully:", { date, meal, calories });
  } catch (error) {
    console.error("Error saving meal:", error);
    throw new Error("Failed to save meal to database");
  }
}

async function saveExercise(date, exercise, duration, calories) {
  try {
    const { data, error } = await supabase
      .from("exercises")
      .insert([{ date, exercise, duration, calories }]);

    if (error) throw error;
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

async function saveTodo(task, dueDate = null) {
  try {
    const { data, error } = await supabase
      .from("todos")
      .insert([{ task, due_date: dueDate }]);

    if (error) throw error;
    console.log("Todo saved successfully:", { task, dueDate });
  } catch (error) {
    console.error("Error saving todo:", error);
    throw new Error("Failed to save todo to database");
  }
}

async function toggleTodo(id) {
  try {
    const { data: currentTodo, error: fetchError } = await supabase
      .from("todos")
      .select("completed")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;

    const { data, error } = await supabase
      .from("todos")
      .update({ completed: !currentTodo.completed })
      .eq("id", id);

    if (error) throw error;
    console.log("Todo toggled successfully:", { id });
  } catch (error) {
    console.error("Error toggling todo:", error);
    throw new Error("Failed to toggle todo in database");
  }
}

async function deleteTodo(id) {
  try {
    const { data, error } = await supabase.from("todos").delete().eq("id", id);

    if (error) throw error;
    console.log("Todo deleted successfully:", { id });
  } catch (error) {
    console.error("Error deleting todo:", error);
    throw new Error("Failed to delete todo from database");
  }
}

async function getAllMeals() {
  try {
    const { data, error } = await supabase
      .from("meals")
      .select("*")
      .order("date", { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching meals:", error);
    throw new Error("Failed to fetch meals from database");
  }
}

async function getAllExercises() {
  try {
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .order("date", { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching exercises:", error);
    throw new Error("Failed to fetch exercises from database");
  }
}

async function getAllTodos() {
  try {
    const { data, error } = await supabase
      .from("todos")
      .select("*")
      .order("due_date", { ascending: true })
      .order("completed", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching todos:", error);
    throw new Error("Failed to fetch todos from database");
  }
}

async function getTodayMeals(today) {
  try {
    const { data, error } = await supabase
      .from("meals")
      .select("*")
      .eq("date", today)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching today's meals:", error);
    throw new Error("Failed to fetch today's meals from database");
  }
}

async function getTodayExercises(today) {
  try {
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .eq("date", today)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching today's exercises:", error);
    throw new Error("Failed to fetch today's exercises from database");
  }
}

module.exports = {
  initializeDatabase,
  saveMeal,
  saveExercise,
  saveTodo,
  toggleTodo,
  deleteTodo,
  getAllMeals,
  getAllExercises,
  getAllTodos,
  getTodayMeals,
  getTodayExercises,
};
