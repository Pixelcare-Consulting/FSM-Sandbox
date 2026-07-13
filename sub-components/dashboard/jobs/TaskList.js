import React, { useState, useEffect, useRef } from "react";
import { Form, Row, Col, Button, Table } from "react-bootstrap";
import Select from "react-select";
import { FaTrash, FaEdit } from "react-icons/fa";
import { toast } from "react-toastify";
import Swal from "sweetalert2";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { jobService } from "../../../lib/supabase/database";
import { sanitizeJobTaskFields } from "../../../lib/jobs/sanitizeJobTaskFields";
import { useRouter } from "next/router";

const mapTaskRowToListItem = (task, index = 0) => ({
  taskID: task.id,
  taskName: task.task_name,
  taskDescription: task.task_description,
  assignedTo: null,
  isPriority: task.is_required,
  isDone: task.is_completed === true,
  completionDate: null,
  taskOrder: task.task_order ?? index,
});

const TaskList = ({ workers, jobNo }) => {
  const [editingTask, setEditingTask] = useState(null);
  const [taskList, setTaskList] = useState([]);

  const [newTask, setNewTask] = useState({
    taskID: "",
    taskName: "",
    taskDescription: "",
    assignedTo: null,
    isPriority: false,
    isDone: false,
    completionDate: null,
  });

  const channelRef = useRef(null);

  useEffect(() => {
    if (!jobNo) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error("Supabase client not available");
      return;
    }

    // Fetch initial tasks (slim job_tasks query — not full job graph)
    const fetchTasks = async () => {
      try {
        const jobTasks = await jobService.findTasksByJobId(jobNo);
        const tasks = (jobTasks || []).map((task, index) => mapTaskRowToListItem(task, index));
        setTaskList(tasks);
      } catch (error) {
        console.error("Error fetching tasks:", error);
        setTaskList([]);
      }
    };

    fetchTasks();

    const patchTaskFromRealtime = (payload) => {
      const { eventType, new: newRow, old: oldRow } = payload;

      if (eventType === "DELETE") {
        const removedId = oldRow?.id;
        if (!removedId) return;
        setTaskList((prev) => prev.filter((task) => task.taskID !== removedId));
        return;
      }

      if (!newRow?.id) return;

      const mapped = mapTaskRowToListItem(newRow);
      setTaskList((prev) => {
        if (eventType === "INSERT") {
          if (prev.some((task) => task.taskID === mapped.taskID)) return prev;
          return [...prev, mapped].sort(
            (a, b) => (a.taskOrder || 0) - (b.taskOrder || 0)
          );
        }

        const idx = prev.findIndex((task) => task.taskID === newRow.id);
        if (idx === -1) {
          return [...prev, mapped].sort(
            (a, b) => (a.taskOrder || 0) - (b.taskOrder || 0)
          );
        }

        return prev.map((task) =>
          task.taskID === newRow.id
            ? {
                ...task,
                ...mapped,
                assignedTo: task.assignedTo,
                completionDate: task.completionDate,
              }
            : task
        );
      });
    };

    // Set up real-time subscription for job_tasks
    const channel = supabase
      .channel(`job-tasks-${jobNo}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_tasks',
          filter: `job_id=eq.${jobNo}`
        },
        (payload) => {
          console.log('Task update received:', payload.eventType);
          patchTaskFromRealtime(payload);
        }
      )
      .subscribe();

    channelRef.current = channel;

    // Cleanup
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [jobNo]);

  const handleAddTask = async () => {
    if (!newTask.taskName.trim()) {
      toast.error("Task name is required");
      return;
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client not available");
      }

      // Get current max task_order
      const maxOrder = taskList.length > 0 
        ? Math.max(...taskList.map(t => t.taskOrder || 0))
        : 0;

      // Insert task into job_tasks table
      const sanitized = sanitizeJobTaskFields({
        taskName: newTask.taskName,
        taskDescription: newTask.taskDescription,
      });
      const { data, error } = await supabase
        .from('job_tasks')
        .insert({
          job_id: jobNo,
          ...sanitized,
          task_order: maxOrder + 1,
          is_required: newTask.isPriority
        })
        .select()
        .single();

      if (error) throw error;

      // Update local state
      const newTaskData = {
        ...newTask,
        taskID: data.id,
        taskOrder: data.task_order
      };
      setTaskList([...taskList, newTaskData]);
      setNewTask({
        taskID: "",
        taskName: "",
        taskDescription: "",
        assignedTo: null,
        isPriority: false,
        isDone: false,
        completionDate: null,
      });

      toast.success("Task added successfully!");
    } catch (error) {
      console.error("Error adding task:", error);
      toast.error("Failed to add task");
    }
  };

  const handleEditTask = (task) => {
    setEditingTask(task);
    setNewTask(task);
  };

  const handleUpdateTask = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client not available");
      }

      // Update task in job_tasks table
      const sanitized = sanitizeJobTaskFields({
        taskName: newTask.taskName,
        taskDescription: newTask.taskDescription,
      });
      const { error } = await supabase
        .from('job_tasks')
        .update({
          ...sanitized,
          is_required: newTask.isPriority
        })
        .eq('id', editingTask.taskID);

      if (error) throw error;

      // Update local state
      const updatedTasks = taskList.map((task) =>
        task.taskID === editingTask.taskID ? { ...newTask, taskID: editingTask.taskID } : task
      );
      setTaskList(updatedTasks);
      setEditingTask(null);
      setNewTask({
        taskID: "",
        taskName: "",
        taskDescription: "",
        assignedTo: null,
        isPriority: false,
        isDone: false,
        completionDate: null,
      });

      toast.success("Task updated successfully!");
    } catch (error) {
      console.error("Error updating task:", error);
      toast.error("Failed to update task");
    }
  };

  const handleDeleteTask = async (taskId) => {
    Swal.fire({
      title: "Are you sure?",
      text: "You won't be able to revert this!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, delete it!",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const supabase = getSupabaseClient();
          if (!supabase) {
            throw new Error("Supabase client not available");
          }

          // Delete task from job_tasks table
          const { error } = await supabase
            .from('job_tasks')
            .delete()
            .eq('id', taskId);

          if (error) throw error;

          // Update local state
          const updatedTasks = taskList.filter(
            (task) => task.taskID !== taskId
          );
          setTaskList(updatedTasks);
          toast.success("Task deleted successfully");
        } catch (error) {
          console.error("Error deleting task:", error);
          toast.error("Failed to delete task");
        }
      }
    });
  };

  return (
    <div>
      <Row className="mb-3">
        <Col md={12}>
          <h5>Task List</h5>
          <p className="text-muted">Add tasks for this job</p>
        </Col>
      </Row>

      <Row className="mb-3">
        <Col md={4}>
          <Form.Group>
            <Form.Label>Task Name</Form.Label>
            <Form.Control
              type="text"
              value={newTask.taskName}
              onChange={(e) =>
                setNewTask({ ...newTask, taskName: e.target.value })
              }
              placeholder="Enter task name"
            />
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group>
            <Form.Label>Description</Form.Label>
            <Form.Control
              type="text"
              value={newTask.taskDescription}
              onChange={(e) =>
                setNewTask({ ...newTask, taskDescription: e.target.value })
              }
              placeholder="Enter task description"
            />
          </Form.Group>
        </Col>
        <Col md={3}>
          <Form.Group>
            <Form.Label>Assigned To</Form.Label>
            <Select
              value={
                workers.find((w) => w.value === newTask.assignedTo) || null
              }
              onChange={(selected) =>
                setNewTask({
                  ...newTask,
                  assignedTo: selected ? selected.value : null,
                })
              }
              options={workers}
              placeholder="Select worker"
              isClearable
            />
          </Form.Group>
        </Col>
        <Col md={1} className="d-flex align-items-end">
          <Button
            variant="primary"
            onClick={editingTask ? handleUpdateTask : handleAddTask}
            className="w-100"
          >
            {editingTask ? "Update" : "Add"}
          </Button>
        </Col>
      </Row>

      <Table striped bordered hover responsive>
        <thead>
          <tr>
            <th>Task Name</th>
            <th>Description</th>
            <th>Assigned To</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {taskList.map((task) => (
            <tr key={task.taskID}>
              <td>{task.taskName}</td>
              <td>{task.taskDescription}</td>
              <td>
                {workers.find((w) => w.value === task.assignedTo)?.label ||
                  "Unassigned"}
              </td>
              <td>
                <Form.Check
                  type="switch"
                  checked={task.isPriority}
                  onChange={(e) => {
                    const updatedTasks = taskList.map((t) =>
                      t.taskID === task.taskID
                        ? { ...t, isPriority: e.target.checked }
                        : t
                    );
                    setTaskList(updatedTasks);
                  }}
                />
              </td>
              <td>
                <Form.Check
                  type="switch"
                  checked={task.isDone}
                  onChange={(e) => {
                    const updatedTasks = taskList.map((t) =>
                      t.taskID === task.taskID
                        ? { ...t, isDone: e.target.checked }
                        : t
                    );
                    setTaskList(updatedTasks);
                  }}
                />
              </td>
              <td>
                <Button
                  variant="outline-primary"
                  size="sm"
                  className="me-2"
                  onClick={() => handleEditTask(task)}
                >
                  <FaEdit />
                </Button>
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => handleDeleteTask(task.taskID)}
                >
                  <FaTrash />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

export default TaskList;
