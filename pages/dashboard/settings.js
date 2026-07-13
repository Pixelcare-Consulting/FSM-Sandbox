import React, { useState, useEffect } from "react";
import {
  Container,
  Row,
  Col,
  Card,
  ListGroup,
  Form,
  Button,
  Modal,
  Table,
  Badge,
} from "react-bootstrap";
import { useRouter } from "next/router";
import { FaCog, FaUser, FaTools, FaTasks, FaEdit, FaTrash, FaBuilding, FaInfo, FaBriefcase, FaClock, FaEnvelope, FaBell, FaBullhorn, FaPlus, FaCamera, FaUpload, FaTimes, FaPhone, FaGlobe, FaMapMarkerAlt, FaCheck, FaAddressCard, FaFileAlt, FaExternalLinkAlt, FaCreditCard, FaChevronRight } from "react-icons/fa";
import { DashboardHeader } from "sub-components";
import Image from "next/image";
import { getSupabaseClient } from "../../lib/supabase/client";
import { getDefaultJobStatuses } from "../../utils/jobStatusSettings";
import { uploadFile, getDownloadURL } from "../../lib/supabase/storage";
import toast from 'react-hot-toast';
import Link from "next/link";
import styles from "./settings.module.css";
import { useLogo } from "../../contexts/LogoContext";
import NotificationsSettingsPanel from "./settings/_components/NotificationsSettingsPanel";
import EmailSettingsPanel from "./settings/_components/EmailSettingsPanel";
import JobIncentiveSettings from "./settings/incentives";
import SessionDevicesPanel from "./settings/_components/SessionDevicesPanel";
import { useSettings } from "../../contexts/SettingsContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { invalidateSettingsCachesClient } from "../../utils/invalidateSettingsCachesClient";

const Settings = () => {
  const router = useRouter();
  const { setLogo } = useLogo(); // Get setLogo from LogoContext
  const { settings: bundleSettings, refreshSettings } = useSettings();
  const [activeTab, setActiveTab] = useState("company-info");
  const [showEditModal, setShowEditModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  

  // Google Forms URLs state
  const [googleFormsUrls, setGoogleFormsUrls] = useState([]);
  const [editingFormIndex, setEditingFormIndex] = useState(null);
  const [newFormUrl, setNewFormUrl] = useState({ name: '', url: '', description: '' });
  const [companyInfo, setCompanyInfo] = useState({
    logo: "",
    name: "",
    address: "",
    email: "",
    phone: "",
    website: "",
    pay_to: "",
    bank_name: "",
    account_no: "",
    paynow: "",
    payment_instruction: "",
  });
  const [file, setFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(companyInfo.logo);
  const fileInputRef = React.useRef(null);
  const [userDetails, setUserDetails] = useState(null);

  const [schedulingWindows, setSchedulingWindows] = useState([]);

  const formatTimeTo12Hour = (time) => {
    if (!time) return '';
    
    try {
      const [hours, minutes] = time.split(":");
      const formattedHours = hours % 12 || 12; // Convert to 12-hour format
      const ampm = hours >= 12 ? "PM" : "AM"; // Determine AM/PM
      return `${formattedHours}:${minutes} ${ampm}`; // Return formatted time
    } catch (error) {
      console.error('Error formatting time:', error);
      return ''; // Return empty string if there's an error
    }
  };

  // Function to add a scheduling window to Supabase
  const addSchedulingWindowToFirestore = async (newWindow) => {
    try {
      // Check for empty or null values
      if (!newWindow.label || !newWindow.timeStart || !newWindow.timeEnd) {
        console.error(
          "Cannot add scheduling window. All fields must be filled."
        );
        return; // Exit the function if any required field is empty
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Add the new window data to Supabase
      const { data, error } = await supabase
        .from('scheduling_windows')
        .insert({
          label: newWindow.label,
          time_start: newWindow.timeStart,
          time_end: newWindow.timeEnd,
          is_public: newWindow.isPublic ?? true
        })
        .select()
        .single();

      if (error) {
        console.error("Error adding scheduling window:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
      console.log("Scheduling window added successfully");
      return data;
    } catch (error) {
      console.error("Error adding scheduling window:", error);
      throw error;
    }
  };

  const [editIndex, setEditIndex] = useState(null);
  const [tempWindow, setTempWindow] = useState({
    label: "",
    timeStart: "",
    timeEnd: "",
    isPublic: true,
  });

  const updateSchedulingWindowInFirestore = async (windowId, updatedWindow) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { error } = await supabase
        .from('scheduling_windows')
        .update({
          label: updatedWindow.label,
          time_start: updatedWindow.timeStart,
          time_end: updatedWindow.timeEnd,
          is_public: updatedWindow.isPublic ?? true
        })
        .eq('id', windowId);

      if (error) throw error;
      console.log("Scheduling window updated successfully");
    } catch (error) {
      console.error("Error updating scheduling window:", error);
      throw error;
    }
  };

  const handleSaveClick = async (index) => {
    try {
      const windowId = schedulingWindows[index].id;
      await updateSchedulingWindowInFirestore(windowId, tempWindow);
      
      // Refresh the windows after update
      await fetchSchedulingWindows();
      setEditIndex(null);
      void clientAuditLog({
        action: 'SETTINGS_UPDATE',
        category: 'settings',
        description: 'Scheduling window updated',
        details: { area: 'scheduling' },
      });
      toast.success("Window updated successfully");
    } catch (error) {
      console.error("Error updating window:", error);
      toast.error("Failed to update window");
    }
  };

  const handleEditClick = (index) => {
    setEditIndex(index);
    setTempWindow(schedulingWindows[index]); // Populate the tempWindow with the current window data
  };

  const handleRemoveClick = async (index) => {
    const windowIdToDelete = schedulingWindows[index].id;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { error } = await supabase
        .from('scheduling_windows')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', windowIdToDelete);

      if (error) throw error;
      console.log("Scheduling window removed successfully:", windowIdToDelete);
      // Update local state after deletion
      setSchedulingWindows((prev) => prev.filter((_, i) => i !== index));
      toast.success('Scheduling window deleted successfully');
    } catch (error) {
      console.error("Error removing scheduling window:", error);
      toast.error('Failed to delete scheduling window');
    }
  };

  const fetchCompanyInfo = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { data, error } = await supabase
        .from('company_details')
        .select('*')
        .eq('id', 'companyInfo')
        .single();
      
      if (error && error.code !== 'PGRST116') {
        throw error;
      }

        if (data) {
          setCompanyInfo(data);
          setLogoPreview(data.logo || ''); // Reset logo preview to current logo
          // Update LogoContext if logo exists
          if (data.logo) {
            setLogo(data.logo);
            localStorage.setItem('companyLogo', data.logo);
          }
        } else {
          console.log("No company information found!");
          setCompanyInfo({
            logo: "",
            name: "",
            address: "",
            email: "",
            phone: "",
            website: "",
            pay_to: "",
            bank_name: "",
            account_no: "",
            paynow: "",
            payment_instruction: "",
          });
        }
    } catch (error) {
      console.error("Error fetching company information:", error);
      toast.error('Failed to fetch company information');
    }
  };



  // Function to fetch scheduling windows from Supabase
  const fetchSchedulingWindows = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { data, error } = await supabase
        .from('scheduling_windows')
        .select('*')
        .is('deleted_at', null)
        .order('time_start', { ascending: true });

      if (error) throw error;

      const windows = (data || []).map(window => ({
        id: window.id,
        label: window.label || '',
        timeStart: window.time_start || '',
        timeEnd: window.time_end || '',
        isPublic: window.is_public ?? true,
        displayTimeStart: window.time_start ? formatTimeTo12Hour(window.time_start) : '',
        displayTimeEnd: window.time_end ? formatTimeTo12Hour(window.time_end) : ''
      }));

      setSchedulingWindows(windows);
    } catch (error) {
      console.error("Error fetching scheduling windows:", error);
      toast.error("Failed to fetch scheduling windows");
    }
  };

  useEffect(() => {
    if (!bundleSettings.companyInfo) return;
    setCompanyInfo(bundleSettings.companyInfo);
    setLogoPreview(bundleSettings.companyInfo.logo || '');
    if (bundleSettings.companyInfo.logo) {
      setLogo(bundleSettings.companyInfo.logo);
      localStorage.setItem('companyLogo', bundleSettings.companyInfo.logo);
    }
  }, [bundleSettings.companyInfo, setLogo]);

  // Helper function to extract form ID from Google Forms URL
  const extractFormId = (url) => {
    try {
      // Google Forms URL patterns:
      // https://docs.google.com/forms/d/e/FORM_ID/viewform
      // https://docs.google.com/forms/d/FORM_ID/viewform
      const match = url.match(/\/forms\/d\/e\/([^\/]+)/) || url.match(/\/forms\/d\/([^\/]+)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  };

  // Google Forms URL management functions
  const fetchGoogleFormsUrls = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { data, error } = await supabase
        .from('google_forms')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      setGoogleFormsUrls(data || []);
    } catch (error) {
      console.error('Error fetching Google Forms URLs:', error);
      toast.error('Failed to fetch Google Forms URLs');
    }
  };

  const handleAddFormUrl = async () => {
    if (!newFormUrl.name.trim() || !newFormUrl.url.trim()) {
      toast.error('Please fill in both name and URL');
      return;
    }

    // Validate URL format
    try {
      new URL(newFormUrl.url);
    } catch (e) {
      toast.error('Please enter a valid URL');
      return;
    }

    // Check if it's a Google Forms URL
    if (!newFormUrl.url.includes('docs.google.com/forms')) {
      toast.error('Please enter a valid Google Forms URL');
      return;
    }

    try {
      setIsSaving(true);
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const formId = extractFormId(newFormUrl.url);

      if (!formId) {
        toast.error('Could not extract form ID from URL. Please check that the URL is a valid Google Forms URL (e.g., https://docs.google.com/forms/d/e/FORM_ID/viewform)');
        setIsSaving(false);
        return;
      }

      const { data, error } = await supabase
        .from('google_forms')
        .insert({
          name: newFormUrl.name.trim(),
          url: newFormUrl.url.trim(),
          form_id: formId,
          description: newFormUrl.description || null,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      await fetchGoogleFormsUrls(); // Refresh the list
      setNewFormUrl({ name: '', url: '', description: '' });
      toast.success('Google Form URL added successfully');
    } catch (error) {
      console.error('Error adding Google Form URL:', error);
      toast.error(`Failed to add Google Form URL: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditFormUrl = (index) => {
    setEditingFormIndex(index);
    const form = googleFormsUrls[index];
    setNewFormUrl({
      name: form.name || '',
      url: form.url || '',
      description: form.description || ''
    });
  };

  const handleUpdateFormUrl = async () => {
    if (!newFormUrl.name.trim() || !newFormUrl.url.trim()) {
      toast.error('Please fill in both name and URL');
      return;
    }

    try {
      new URL(newFormUrl.url);
    } catch (e) {
      toast.error('Please enter a valid URL');
      return;
    }

    if (!newFormUrl.url.includes('docs.google.com/forms')) {
      toast.error('Please enter a valid Google Forms URL');
      return;
    }

    try {
      setIsSaving(true);
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const formToUpdate = googleFormsUrls[editingFormIndex];
      const formId = extractFormId(newFormUrl.url);

      if (!formId) {
        toast.error('Could not extract form ID from URL. Please check that the URL is a valid Google Forms URL (e.g., https://docs.google.com/forms/d/e/FORM_ID/viewform)');
        setIsSaving(false);
        return;
      }

      const { error } = await supabase
        .from('google_forms')
        .update({
          name: newFormUrl.name.trim(),
          url: newFormUrl.url.trim(),
          form_id: formId,
          description: newFormUrl.description || null
        })
        .eq('id', formToUpdate.id);

      if (error) throw error;

      await fetchGoogleFormsUrls(); // Refresh the list
      setEditingFormIndex(null);
      setNewFormUrl({ name: '', url: '', description: '' });
      toast.success('Google Form URL updated successfully');
    } catch (error) {
      console.error('Error updating Google Form URL:', error);
      toast.error(`Failed to update Google Form URL: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFormUrl = async (index) => {
    if (!window.confirm('Are you sure you want to delete this Google Form URL?')) {
      return;
    }

    try {
      setIsSaving(true);
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const formToDelete = googleFormsUrls[index];

      const { error } = await supabase
        .from('google_forms')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', formToDelete.id);

      if (error) throw error;

      await fetchGoogleFormsUrls(); // Refresh the list
      toast.success('Google Form URL deleted successfully');
    } catch (error) {
      console.error('Error deleting Google Form URL:', error);
      toast.error(`Failed to delete Google Form URL: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingFormIndex(null);
    setNewFormUrl({ name: '', url: '', description: '' });
  };

  const handleNavigation = (tab) => {
    if (tab === "company-memos") {
      router.push("/dashboard/company-memos");
      return;
    }
    setActiveTab(tab);
  };

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const handleShowScheduleModal = () => setShowScheduleModal(true);
  const handleCloseScheduleModal = () => setShowScheduleModal(false);

  const handleImageChange = (event) => {
    const selectedFile = event.target.files[0];
    
    // Validate file type
    if (!selectedFile.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    
    // Validate file size (e.g., 5MB limit)
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB in bytes
    if (selectedFile.size > MAX_SIZE) {
      toast.error('Image size must be less than 5MB');
      return;
    }

    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = () => {
        setLogoPreview(reader.result);
      };
      reader.readAsDataURL(selectedFile);
      setFile(selectedFile);
    }
  };

  const handleRemoveImage = () => {
    setLogoPreview(""); // Reset to default logo
    setFile(null); // Clear the selected file
  };

  const handleMenuClick = (menu) => {
    console.log(`Navigating to: ${menu}`);
  };

  const handleEditModalShow = () => {
    // Reset logo preview to current logo when opening modal
    setLogoPreview(companyInfo.logo || '');
    setFile(null); // Clear any previously selected file
    setShowEditModal(true);
  };
  
  const handleEditModalClose = () => {
    // Reset logo preview to current logo when closing modal (in case user cancelled)
    setLogoPreview(companyInfo.logo || '');
    setFile(null); // Clear any selected file
    setShowEditModal(false);
  };

  const handleCompanyInfoChange = (e) => {
    const { name, value } = e.target;
    setCompanyInfo((prev) => ({
      ...prev,
      [name]: value,
    }));
  };


  const { user: currentUser } = useCurrentUser();

  useEffect(() => {
    if (!currentUser) return;
    setUserDetails({
      workerId: currentUser.workerId || currentUser.id,
      id: currentUser.id || currentUser.uid,
      email: currentUser.email,
    });
  }, [currentUser]);

  const [isUploading, setIsUploading] = useState(false);

  const handleCompanyInfoSave = async () => {
    try {
      let logoUrl = companyInfo.logo;
      // Use workerId from userDetails/currentUser, or 'company' prefix for shared logo path
      const workerId = userDetails?.workerId || currentUser?.workerId || 'company';

      if (file) {
        try {
          // Generate a unique filename using timestamp
          const timestamp = Date.now();
          // Sanitize filename - remove any undefined values
          const sanitizedWorkerId = workerId && workerId !== 'undefined' ? workerId : 'company';
          const fileName = `${sanitizedWorkerId}-${timestamp}-${file.name}`;
          
          // Convert file to base64 for API upload
          const reader = new FileReader();
          const fileData = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          
          // Upload via API route (uses service role, bypasses RLS)
          const response = await fetch('/api/upload-company-logo', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              path: fileName,
              fileData: fileData,
              contentType: file.type || 'image/jpeg'
            }),
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
          }
          
          const result = await response.json();
          logoUrl = result.url;
          console.log("New logo uploaded. Download URL:", logoUrl);
        } catch (storageError) {
          console.error("Error uploading logo:", storageError);
          toast.error('Failed to upload company logo');
          return; // Exit early if logo upload fails
        }
      }

      // Update company details in Supabase
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Update company_details table
      const { error: updateError } = await supabase
        .from('company_details')
        .upsert({
          id: 'companyInfo',
          ...companyInfo,
          logo: logoUrl,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });

      if (updateError) {
        throw updateError;
      }

      // Update local state
      setCompanyInfo(prev => ({
        ...prev,
        logo: logoUrl
      }));

      // Update logo preview
      setLogoPreview(logoUrl);

      // Update LogoContext to refresh header logo immediately
      setLogo(logoUrl);
      
      // Update localStorage cache
      localStorage.setItem('companyLogo', logoUrl);
      
      // Clear company details cache to force refresh
      localStorage.removeItem('companyDetails');

      toast.success('Company Information updated successfully!');
      void invalidateSettingsCachesClient();
      void clientAuditLog({
        action: 'SETTINGS_UPDATE',
        category: 'settings',
        description: 'Company information updated',
        details: { area: 'company' },
      });
      handleEditModalClose();
      
      // Clear file state after successful upload
      setFile(null);
    } catch (error) {
      console.error("Error updating company information:", error);
      toast.error('Failed to update company information');
    } finally {
      setIsUploading(false);
    }
  };


  const renderContent = () => {
    switch (activeTab) {
      case "company-info":
        return (
          <div className="company-info-container">
            {/* Header Card */}
            <Card className="shadow-sm border-0 mb-4 header-card">
              <Card.Body className="d-flex justify-content-between align-items-center p-4">
                <div>
                  <Image
                    src={logoPreview || companyInfo.logo || "/images/NoImage.png"}
                    alt="Company Logo"
                    width={80}
                    height={80}
                    className="rounded-circle company-logo"
                  />
                  <div className="ms-4">
                    <h4 className="mb-1">{companyInfo.name || 'Your Company Name'}</h4>
                    <p className="text-muted mb-0">
                      <FaMapMarkerAlt className="me-2" />
                      {companyInfo.address || 'N/A'}
                    </p>
                  </div>
                </div>
                <Button 
                  variant="primary" 
                  className="edit-button"
                  onClick={() => setIsEditing(true)}
                >
                  <FaEdit className="me-2" />
                  Edit Profile
                </Button>
              </Card.Body>
            </Card>

            {/* Details Cards */}
            <div className="row g-4">
              {/* Contact Information */}
              <div className="col-md-6">
                <Card className="shadow-sm border-0 h-100">
                  <Card.Body className="p-4">
                    <h5 className="card-title mb-4">
                      <FaAddressCard className="me-2 text-primary" />
                      Contact Information
                    </h5>
                    
                    <div className="info-item mb-4">
                      <label className="text-muted small mb-1">Email Address</label>
                      <div className="d-flex align-items-center">
                        <FaEnvelope className="text-primary me-2" />
                        <span className="fw-medium">
                          {companyInfo.email || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="info-item mb-4">
                      <label className="text-muted small mb-1">Phone Number</label>
                      <div className="d-flex align-items-center">
                        <FaPhone className="text-primary me-2" />
                        <span className="fw-medium">
                          {companyInfo.phone || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="info-item">
                      <label className="text-muted small mb-1">Website</label>
                      <div className="d-flex align-items-center">
                        <FaGlobe className="text-primary me-2" />
                        <span className="fw-medium">
                          {companyInfo.website ? (
                            <a href={companyInfo.website} target="_blank" rel="noreferrer" className="text-decoration-none">
                              {companyInfo.website}
                            </a>
                          ) : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </div>

              {/* Company Details */}
              <div className="col-md-6">
                <Card className="shadow-sm border-0 h-100">
                  <Card.Body className="p-4">
                    <h5 className="card-title mb-4">
                      <FaBuilding className="me-2 text-primary" />
                      Company Details
                    </h5>

                    <div className="info-item mb-4">
                      <label className="text-muted small mb-1">Company Name</label>
                      <div className="d-flex align-items-center">
                        <span className="fw-medium">
                          {companyInfo.name || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="info-item">
                      <label className="text-muted small mb-1">Business Address</label>
                      <div className="d-flex align-items-center">
                        <FaMapMarkerAlt className="text-primary me-2" />
                        <span className="fw-medium">
                          {companyInfo.address || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </div>
            </div>

            {/* Edit Modal */}
            <Modal show={isEditing} onHide={() => setIsEditing(false)} size="lg">
              <Modal.Header closeButton>
                <Modal.Title>Edit Company Information</Modal.Title>
              </Modal.Header>
              <Modal.Body className="p-4">
                <div className="text-center mb-4">
                  <div className="position-relative d-inline-block">
                    <Image
                      src={logoPreview || companyInfo.logo || "/images/NoImage.png"}
                      alt="Company Logo"
                      width={120}
                      height={120}
                      className="rounded-circle border"
                    />
                    <Button 
                      variant="primary" 
                      size="sm" 
                      className="position-absolute bottom-0 end-0 rounded-circle p-2"
                      onClick={() => fileInputRef.current.click()}
                    >
                      <FaCamera />
                    </Button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="d-none"
                      onChange={handleImageChange}
                      accept="image/*"
                    />
                  </div>
                </div>

                <Form>
                  <Row className="g-4">
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Company Name</Form.Label>
                        <Form.Control
                          type="text"
                          name="name"
                          value={companyInfo.name}
                          onChange={handleCompanyInfoChange}
                          placeholder="Enter company name"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Email Address</Form.Label>
                        <Form.Control
                          type="email"
                          name="email"
                          value={companyInfo.email}
                          onChange={handleCompanyInfoChange}
                          placeholder="Enter email address"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Phone Number</Form.Label>
                        <Form.Control
                          type="text"
                          name="phone"
                          value={companyInfo.phone}
                          onChange={handleCompanyInfoChange}
                          placeholder="Enter phone number"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Website</Form.Label>
                        <Form.Control
                          type="text"
                          name="website"
                          value={companyInfo.website}
                          onChange={handleCompanyInfoChange}
                          placeholder="Enter website URL"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={12}>
                      <Form.Group>
                        <Form.Label>Business Address</Form.Label>
                        <Form.Control
                          type="text"
                          name="address"
                          value={companyInfo.address}
                          onChange={handleCompanyInfoChange}
                          placeholder="Enter business address"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                </Form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="light" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button 
                  variant="primary" 
                  onClick={handleCompanyInfoSave}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </Modal.Footer>
            </Modal>
          </div>
        );
      case "pay-now":
        return (
          <Card className="shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                  <h5 className="mb-1">Payment Profiles (Pay Now & Bank Transfer)</h5>
                  <p className="text-muted mb-0">
                    Configure multiple banks (e.g. DBS for PayNow, UOB for bank transfer). Select per job which bank to use.
                  </p>
                </div>
                <Button variant="primary" onClick={() => {
                  setEditingPaymentProfile(null);
                  setPaymentProfileForm({ label: '', pay_to: '', bank_name: '', account_no: '', paynow_uen: '', paynow_uen_qr: '' });
                  setShowPaymentProfileModal(true);
                }}>
                  <FaPlus className="me-2" /> Add Profile
                </Button>
              </div>

              <Table responsive>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Bank</th>
                    <th>Pay To</th>
                    <th>PayNow UEN</th>
                    <th>Default</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentProfiles.map((p) => (
                    <tr key={p.id}>
                      <td>{p.label}</td>
                      <td>{p.bank_name || '-'}</td>
                      <td>{p.pay_to || '-'}</td>
                      <td>{p.paynow_uen || p.paynow_uen_qr || '-'}</td>
                      <td>{p.is_default ? <Badge bg="success">Default</Badge> : (
                        <Button size="sm" variant="outline-secondary" onClick={async () => {
                          try {
                            const supabase = getSupabaseClient();
                            if (!supabase) return;
                            await supabase.from('payment_profiles').update({ is_default: false }).is('deleted_at', null);
                            await supabase.from('payment_profiles').update({ is_default: true, updated_at: new Date().toISOString() }).eq('id', p.id);
                            toast.success(`"${p.label}" set as default`);
                            fetchPaymentProfiles();
                          } catch (err) {
                            toast.error('Failed to set default');
                          }
                        }}>Set Default</Button>
                      )}</td>
                      <td>
                        <Button size="sm" variant="outline-primary" className="me-1" onClick={() => {
                          setEditingPaymentProfile(p);
                          setPaymentProfileForm({ label: p.label, pay_to: p.pay_to || '', bank_name: p.bank_name || '', account_no: p.account_no || '', paynow_uen: p.paynow_uen || '', paynow_uen_qr: p.paynow_uen_qr || '' });
                          setShowPaymentProfileModal(true);
                        }}><FaEdit /></Button>
                        <Button size="sm" variant="outline-danger" onClick={async () => {
                          if (!confirm('Delete this payment profile?')) return;
                          try {
                            const supabase = getSupabaseClient();
                            if (!supabase) return;
                            await supabase.from('payment_profiles').update({ deleted_at: new Date().toISOString() }).eq('id', p.id);
                            toast.success('Profile deleted');
                            fetchPaymentProfiles();
                          } catch (err) {
                            toast.error('Failed to delete');
                          }
                        }}><FaTrash /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {paymentProfiles.length === 0 && (
                <p className="text-muted mb-0">No payment profiles yet. Add one to configure PayNow and bank transfer details per job.
                  Run the migration <code>create_payment_profiles_table.sql</code> if the table does not exist.</p>
              )}

              <Modal show={showPaymentProfileModal} onHide={() => setShowPaymentProfileModal(false)} size="lg">
                <Modal.Header closeButton>
                  <Modal.Title>{editingPaymentProfile ? 'Edit' : 'Add'} Payment Profile</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  <Form>
                    <Row className="g-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Label <span className="text-danger">*</span></Form.Label>
                          <Form.Control placeholder="e.g., DBS (PayNow)" value={paymentProfileForm.label} onChange={(e) => setPaymentProfileForm({ ...paymentProfileForm, label: e.target.value })} />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Bank Name</Form.Label>
                          <Form.Control placeholder="e.g., DBS Bank" value={paymentProfileForm.bank_name} onChange={(e) => setPaymentProfileForm({ ...paymentProfileForm, bank_name: e.target.value })} />
                        </Form.Group>
                      </Col>
                      <Col md={12}>
                        <Form.Group>
                          <Form.Label>Pay To</Form.Label>
                          <Form.Control placeholder="e.g., SAS M & E PTE LTD" value={paymentProfileForm.pay_to} onChange={(e) => setPaymentProfileForm({ ...paymentProfileForm, pay_to: e.target.value })} />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Account No (bank transfer)</Form.Label>
                          <Form.Control placeholder="e.g., 375-303-059-8" value={paymentProfileForm.account_no} onChange={(e) => setPaymentProfileForm({ ...paymentProfileForm, account_no: e.target.value })} />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>PayNow UEN (display on PDF)</Form.Label>
                          <Form.Control placeholder="e.g., 201019107Z" value={paymentProfileForm.paynow_uen} onChange={(e) => setPaymentProfileForm({ ...paymentProfileForm, paynow_uen: e.target.value })} />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>PayNow QR UEN (UEN + bank code)</Form.Label>
                          <Form.Control placeholder="e.g., 201019107ZDBS" value={paymentProfileForm.paynow_uen_qr} onChange={(e) => setPaymentProfileForm({ ...paymentProfileForm, paynow_uen_qr: e.target.value })} />
                          <Form.Text className="text-muted">Full string for QR scan (e.g. 201019107ZDBS = DBS, 201019107ZUOB = UOB)</Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>
                  </Form>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="light" onClick={() => setShowPaymentProfileModal(false)}>Cancel</Button>
                  <Button variant="primary" disabled={isSaving} onClick={async () => {
                    if (!paymentProfileForm.label) { toast.error('Label is required'); return; }
                    try {
                      setIsSaving(true);
                      const supabase = getSupabaseClient();
                      if (!supabase) throw new Error('Supabase client not available');
                      const payload = { ...paymentProfileForm, updated_at: new Date().toISOString() };
                      if (editingPaymentProfile) {
                        const { error } = await supabase.from('payment_profiles').update(payload).eq('id', editingPaymentProfile.id);
                        if (error) throw error;
                        toast.success('Profile updated');
                      } else {
                        const needsDefault = paymentProfiles.length === 0;
                        const { error } = await supabase.from('payment_profiles').insert({ ...payload, is_default: needsDefault });
                        if (error) throw error;
                        toast.success('Profile added');
                      }
                      void clientAuditLog({
                        action: 'SETTINGS_UPDATE',
                        category: 'settings',
                        description: editingPaymentProfile ? 'Payment profile updated' : 'Payment profile added',
                        details: { area: 'payment_profiles' },
                      });
                      setShowPaymentProfileModal(false);
                      fetchPaymentProfiles();
                    } catch (err) {
                      console.error(err);
                      toast.error('Failed to save');
                    } finally {
                      setIsSaving(false);
                    }
                  }}>
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </Modal.Footer>
              </Modal>
            </Card.Body>
          </Card>
        );
      case "google-forms":
        return (
          <Card className="shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                  <h5 className="mb-1">Google Forms URLs</h5>
                  <p className="text-muted mb-0">
                    Manage Google Forms URL links for form submissions and integrations.
                  </p>
                </div>
              </div>

              {/* Add New Form URL */}
              <Card className="mb-4 border-primary">
                <Card.Body>
                  <h6 className="mb-3">
                    {editingFormIndex !== null ? 'Edit Google Form URL' : 'Add New Google Form URL'}
                  </h6>
                  <Row className="g-3">
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Form Name <span className="text-danger">*</span></Form.Label>
                        <Form.Control
                          type="text"
                          placeholder="e.g., Customer Inquiry Form"
                          value={newFormUrl.name}
                          onChange={(e) => setNewFormUrl({ ...newFormUrl, name: e.target.value })}
                        />
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group>
                        <Form.Label>Google Forms URL <span className="text-danger">*</span></Form.Label>
                        <Form.Control
                          type="url"
                          placeholder="https://docs.google.com/forms/d/e/..."
                          value={newFormUrl.url}
                          onChange={(e) => setNewFormUrl({ ...newFormUrl, url: e.target.value })}
                        />
                        <Form.Text className="text-muted">
                          Must be a valid Google Forms URL (docs.google.com/forms)
                        </Form.Text>
                      </Form.Group>
                    </Col>
                    <Col md={2} className="d-flex align-items-end">
                      {editingFormIndex !== null ? (
                        <>
                          <Button
                            variant="success"
                            className="me-2"
                            onClick={handleUpdateFormUrl}
                            disabled={isSaving}
                          >
                            <FaCheck /> Update
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                          >
                            <FaTimes /> Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={handleAddFormUrl}
                          disabled={isSaving}
                          className="w-100"
                        >
                          <FaPlus /> Add
                        </Button>
                      )}
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              {/* List of Google Forms URLs */}
              {googleFormsUrls.length > 0 ? (
                <Table striped bordered hover>
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>Form Name</th>
                      <th style={{ width: '50%' }}>URL</th>
                      <th style={{ width: '20%' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleFormsUrls.map((form, index) => (
                      <tr key={form.id || index}>
                        <td>
                          <strong>{form.name}</strong>
                        </td>
                        <td>
                          <div className="d-flex align-items-center">
                            <a
                              href={form.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-truncate me-2"
                              style={{ maxWidth: '400px', display: 'inline-block' }}
                            >
                              {form.url}
                            </a>
                            <FaExternalLinkAlt className="text-muted" size={12} />
                          </div>
                        </td>
                        <td>
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 me-2"
                            onClick={() => handleEditFormUrl(index)}
                            title="Edit"
                          >
                            <FaEdit />
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 text-danger"
                            onClick={() => handleDeleteFormUrl(index)}
                            title="Delete"
                          >
                            <FaTrash />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Card className="border-0 bg-light">
                  <Card.Body className="text-center py-5">
                    <FaFileAlt size={48} className="text-muted mb-3" />
                    <p className="text-muted mb-0">
                      No Google Forms URLs configured yet. Add your first form URL above.
                    </p>
                  </Card.Body>
                </Card>
              )}
            </Card.Body>
          </Card>
        );
      case "options":
        return (
          <Card className="shadow-sm">
            <Card.Body>
              <h5>Options</h5>
              <p className="text-muted">
                Manage your company information, preferences, and various
                settings
              </p>

              <h6>General</h6>
              <ListGroup variant="flush">
                <ListGroup.Item
                  action
                  onClick={() => handleEditModalShow(true)}
                >
                  <i data-feather="info"></i> Company Information
                  <p className="text-muted small mb-0">
                    View and edit your company&apos;s information
                  </p>
                </ListGroup.Item>
              </ListGroup>

              <h6 className="mt-4">Access Management</h6>
              <ListGroup variant="flush">
                <ListGroup.Item
                  action
                  // onClick={() => handleShowScheduleModal()}
                >
                  <i data-feather="lock"></i> Login History
                  <p className="text-muted small mb-0">
                    Track and review login activity
                  </p>
                </ListGroup.Item>
              </ListGroup>
            </Card.Body>
          </Card>
        );
      case "notifications":
        return <NotificationsSettingsPanel />;
      case "email":
        return <EmailSettingsPanel />;
      case "incentives":
        return <JobIncentiveSettings embedded />;
      case "session-devices":
        return <SessionDevicesPanel />;

      case "schedulingwindows":
        return (
          <Card className="shadow-sm">
            <Card.Body>
              <h5>Scheduling Windows</h5>
              <p>Set default scheduling windows for jobs (Morning, Afternoon, etc.).</p>
              
              <Table striped bordered hover className="mt-4">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Time Start</th>
                    <th>Time End</th>
                    <th>Public</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {schedulingWindows.map((window, index) => (
                    <tr key={window.id || `window-${index}`}>
                      <td>
                        {editIndex === index ? (
                          <Form.Control
                            type="text"
                            value={tempWindow.label}
                            onChange={(e) => setTempWindow({...tempWindow, label: e.target.value})}
                          />
                        ) : (
                          window.label
                        )}
                      </td>
                      <td>
                        {editIndex === index ? (
                          <Form.Control
                            type="time"
                            value={tempWindow.timeStart}
                            onChange={(e) => setTempWindow({...tempWindow, timeStart: e.target.value})}
                          />
                        ) : (
                          window.timeStart
                        )}
                      </td>
                      <td>
                        {editIndex === index ? (
                          <Form.Control
                            type="time"
                            value={tempWindow.timeEnd}
                            onChange={(e) => setTempWindow({...tempWindow, timeEnd: e.target.value})}
                          />
                        ) : (
                          window.timeEnd
                        )}
                      </td>
                      <td>
                        {editIndex === index ? (
                          <Form.Select
                            value={tempWindow.isPublic ? "yes" : "no"}
                            onChange={(e) => setTempWindow({...tempWindow, isPublic: e.target.value === "yes"})}
                          >
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </Form.Select>
                        ) : (
                          window.isPublic ? "Yes" : "No"
                        )}
                      </td>
                      <td>
                        {editIndex === index ? (
                          <>
                            <Button variant="success" size="sm" onClick={() => handleSaveClick(index)} className="me-2">
                              Save
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setEditIndex(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="link" onClick={() => handleEditClick(index)} className="p-0 me-2">
                              <i className="fas fa-edit"></i>
                            </Button>
                            <Button variant="link" onClick={() => handleRemoveClick(index)} className="p-0 text-danger">
                              <i className="fas fa-trash-alt"></i>
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr key="new-window-row">
                    <td>
                      <Form.Control type="text" placeholder="Label" id="label" />
                    </td>
                    <td>
                      <Form.Control type="time" id="timeStart" />
                    </td>
                    <td>
                      <Form.Control type="time" id="timeEnd" />
                    </td>
                    <td>
                      <Form.Select id="isPublic">
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </Form.Select>
                    </td>
                    <td>
                      <Button
                        variant="primary"
                        onClick={async () => {
                          const newWindow = {
                            label: document.getElementById("label").value,
                            timeStart: document.getElementById("timeStart").value,
                            timeEnd: document.getElementById("timeEnd").value,
                            isPublic: document.getElementById("isPublic").value === "yes",
                            userId: currentUser?.workerId || userDetails?.workerId,
                          };

                          try {
                            await addSchedulingWindowToFirestore(newWindow);
                            // Refresh the list to get the actual data from database
                            await fetchSchedulingWindows();
                            toast.success('Scheduling window added successfully');

                            // Clear inputs
                            document.getElementById("label").value = "";
                            document.getElementById("timeStart").value = "";
                            document.getElementById("timeEnd").value = "";
                            document.getElementById("isPublic").value = "yes";
                          } catch (error) {
                            console.error("Error adding window:", error);
                            toast.error('Failed to add scheduling window');
                          }
                        }}
                      >
                        Add Window
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        );
      case "followuptasks":
        return (
          <div className={styles.followUpContainer}>
            <Row>
              <Col className="mb-4">
                <Card className={styles.taskCard}>
                 
                  <Card.Body className={styles.cardBody}>
                    {/* Add New Type Form */}
                    <div className={styles.addTypeForm}>
                      <Form.Group className="mb-3">
                        <Form.Control
                          type="text"
                          placeholder="Enter new follow-up type name"
                          value={newType.name}
                          onChange={(e) => setNewType({...newType, name: e.target.value})}
                        />
                      </Form.Group>
                      <div className="d-flex gap-2 mb-4">
                        <Form.Control
                          type="color"
                          value={newType.color}
                          onChange={(e) => setNewType({...newType, color: e.target.value})}
                          title="Choose type color"
                          className={styles.colorPicker}
                        />
                        <Button 
                          variant="primary" 
                          onClick={handleAddType}
                          disabled={isSaving}
                          className={styles.addButton}
                        >
                          <FaPlus size={16} /> Add Type
                        </Button>
                      </div>
                    </div>

                    {/* Types List */}
                    <div className={styles.typesList}>
                      {followUpSettings?.types && Object.entries(followUpSettings.types).map(([typeId, type]) => (
                        <div key={typeId} className={styles.typeItem}>
                          {editingType?.id === typeId ? (
                            // Edit mode
                            <div className="d-flex align-items-center gap-2 w-100">
                              <Form.Control
                                type="text"
                                value={editingType.name}
                                onChange={(e) => setEditingType(prev => ({
                                  ...prev,
                                  name: e.target.value
                                }))}
                                placeholder="Enter type name"
                                className="flex-grow-1"
                              />
                              <Form.Control
                                type="color"
                                value={editingType.color}
                                onChange={(e) => setEditingType(prev => ({
                                  ...prev,
                                  color: e.target.value
                                }))}
                                title="Choose type color"
                                style={{ width: '50px' }}
                              />
                              <Button
                                variant="success"
                                size="sm"
                                onClick={() => handleUpdateType(typeId)}
                                className="px-3"
                              >
                                <FaCheck />
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setEditingType(null)}
                                className="px-3"
                              >
                                <FaTimes />
                              </Button>
                            </div>
                          ) : (
                            // View mode
                            <div className="d-flex justify-content-between align-items-center w-100">
                              <div className="d-flex align-items-center gap-2">
                                <div 
                                  className={styles.colorBox} 
                                  style={{ backgroundColor: type.color }}
                                />
                                <span className={styles.typeName}>{type.name}</span>
                              </div>
                              <div className={styles.typeActions}>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="p-0 me-2"
                                  onClick={() => handleEditType(typeId)}
                                >
                                  <FaEdit />
                                </Button>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="p-0 text-danger"
                                  onClick={() => handleDeleteType(typeId)}
                                >
                                  <FaTrash />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </div>
        );
      case "jobstatuses":
        return (
          <div className={styles.followUpContainer}>
            <Row>
              <Col className="mb-4">
                <Card className={styles.taskCard}>
                  <Card.Body className={styles.cardBody}>
                    <div className={styles.addTypeForm}>
                      <Form.Group className="mb-3">
                        <Form.Control
                          type="text"
                          placeholder="Enter status name (e.g. Created)"
                          value={newJobStatusType.name}
                          onChange={(e) => setNewJobStatusType((prev) => ({ ...prev, name: e.target.value }))}
                        />
                      </Form.Group>
                      <Form.Group className="mb-2">
                        <Form.Control
                          type="text"
                          placeholder="DB value (e.g. CREATED or 554 for SAP)"
                          value={newJobStatusType.value}
                          onChange={(e) => setNewJobStatusType((prev) => ({ ...prev, value: e.target.value }))}
                        />
                        <Form.Text className="text-muted">
                          Use SAP status ID (e.g. 554, 555, -5) to control name and color for that status in Create/Edit Job.
                        </Form.Text>
                      </Form.Group>
                      <div className="d-flex gap-2 mb-4">
                        <Form.Control
                          type="color"
                          value={newJobStatusType.color}
                          onChange={(e) => setNewJobStatusType((prev) => ({ ...prev, color: e.target.value }))}
                          title="Choose status color"
                          className={styles.colorPicker}
                        />
                        <Button
                          variant="primary"
                          onClick={handleAddJobStatusType}
                          disabled={isSaving}
                          className={styles.addButton}
                        >
                          <FaPlus size={16} /> Add Type
                        </Button>
                      </div>
                    </div>
                    <div className={styles.typesList}>
                      {jobStatusSettings?.types && Object.entries(jobStatusSettings.types).map(([typeId, type]) => (
                        <div key={typeId} className={styles.typeItem}>
                          {editingJobStatusType?.id === typeId ? (
                            <div className="d-flex align-items-center gap-2 w-100 flex-wrap">
                              <Form.Control
                                type="text"
                                value={editingJobStatusType.name}
                                onChange={(e) => setEditingJobStatusType((prev) => ({ ...prev, name: e.target.value }))}
                                placeholder="Status name"
                                className="flex-grow-1"
                                style={{ minWidth: "120px" }}
                              />
                              <Form.Control
                                type="text"
                                value={editingJobStatusType.value}
                                onChange={(e) => setEditingJobStatusType((prev) => ({ ...prev, value: e.target.value }))}
                                placeholder="Value"
                                style={{ width: "100px" }}
                              />
                              <Form.Control
                                type="color"
                                value={editingJobStatusType.color}
                                onChange={(e) => setEditingJobStatusType((prev) => ({ ...prev, color: e.target.value }))}
                                title="Color"
                                style={{ width: "50px" }}
                              />
                              <Button variant="success" size="sm" onClick={() => handleUpdateJobStatusType(typeId)} className="px-3">
                                <FaCheck />
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => setEditingJobStatusType(null)} className="px-3">
                                <FaTimes />
                              </Button>
                            </div>
                          ) : (
                            <div className="d-flex justify-content-between align-items-center w-100">
                              <div className="d-flex align-items-center gap-2">
                                <div className={styles.colorBox} style={{ backgroundColor: type.color }} />
                                <span className={styles.typeName}>{type.name}</span>
                                <small className="text-muted">({type.value})</small>
                              </div>
                              <div className={styles.typeActions}>
                                <Button variant="link" size="sm" className="p-0 me-2" onClick={() => handleEditJobStatusType(typeId)}>
                                  <FaEdit />
                                </Button>
                                <Button variant="link" size="sm" className="p-0 text-danger" onClick={() => handleDeleteJobStatusType(typeId)}>
                                  <FaTrash />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </div>
        );
      default:
        return null;
    }
  };

  // Add new state for follow-up settings
  const [followUpSettings, setFollowUpSettings] = useState({
    types: {},
    statuses: []
  });

  // Job statuses settings (custom statuses with colors for Create/Edit Job)
  const [jobStatusSettings, setJobStatusSettings] = useState({ types: {} });
  const [newJobStatusType, setNewJobStatusType] = useState({
    name: "",
    color: "#3b82f6",
    value: ""
  });
  const [editingJobStatusType, setEditingJobStatusType] = useState(null);

  // Add function to fetch follow-up settings
  const fetchFollowUpSettings = async () => {
    await refreshSettings();
  };


  const fetchPaymentProfiles = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data, error } = await supabase
        .from('payment_profiles')
        .select('*')
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setPaymentProfiles(data || []);
    } catch (err) {
      console.error('Error fetching payment profiles:', err);
      toast.error('Failed to load payment profiles');
    }
  };

  // Update your useEffect to fetch scheduling windows
  useEffect(() => {
    fetchSchedulingWindows();
    fetchGoogleFormsUrls();
    fetchPaymentProfiles();
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const hash = (router.asPath.split("#")[1] || "").toLowerCase();
    if (hash === "notifications") setActiveTab("notifications");
    if (hash === "email" || hash === "email-settings") setActiveTab("email");
    if (hash === "incentives" || hash === "job-incentives") setActiveTab("incentives");
  }, [router.isReady, router.asPath]);

  // First, let's organize the settings into clear categories
  const settingsCategories = [
    {
      title: "Company Settings",
      icon: <FaBuilding className="me-2" />,
      items: [
        {
          name: "Company Information",
          description: "Manage your company profile, logo, and contact details",
          icon: <FaInfo className="me-2" />,
          action: "company-info",
        },
        {
          name: "Google Forms",
          description: "Configure and manage Google Forms URL links",
          icon: <FaFileAlt className="me-2" />,
          action: "google-forms",
        },
        {
          name: "Pay Now Details",
          description: "Configure PayNow, bank transfer details for jobsheet PDFs",
          icon: <FaCreditCard className="me-2" />,
          action: "pay-now",
        },
      ],
    },
    {
      title: "Job Management",
      icon: <FaBriefcase className="me-2" />,
      items: [
        {
          name: "Scheduling Windows",
          description: "Set default time slots for job scheduling (Morning, Afternoon, etc.)",
          icon: <FaClock className="me-2" />,
          action: "schedulingwindows",
        },
        {
          name: "Follow-Up Tasks",
          description: "Manage follow-up types and status workflows",
          icon: <FaTasks className="me-2" />,
          action: "followuptasks",
        },
        {
          name: "Job Statuses",
          description: "Manage job statuses with custom names and colors",
          icon: <FaBriefcase className="me-2" />,
          action: "jobstatuses",
        },
        {
          name: "Job Incentives",
          description: "SAP job schedule sync, technician codes, and incentive reports",
          icon: <FaTools className="me-2" />,
          action: "incentives",
        },
      ]
    },
    {
      title: "Communications",
      icon: <FaEnvelope className="me-2" />,
      items: [
        {
          name: "Notifications",
          description: "Configure SMS and push notification settings",
          icon: <FaBell className="me-2" />,
          action: "notifications",
        },
        {
          name: "Email Settings",
          description: "Set up automated email notifications",
          icon: <FaEnvelope className="me-2" />,
          action: "email",
        },
        {
          name: "Company memos",
          description: "Header ticker and sign-in announcements",
          icon: <FaBullhorn className="me-2" />,
          action: "company-memos",
          adminOnly: true,
        },
      ],
    },
    {
      title: "Access Management",
      icon: <FaUser className="me-2" />,
      items: [
        {
          name: "Session & Devices",
          description:
            "Reset your session if you're locked out on the mobile app",
          icon: <FaUser className="me-2" />,
          action: "session-devices",
          promoBadge: "NEW",
        },
      ],
    },
  ];

  // Add this function inside your Settings component
  const getCurrentPageTitle = () => {
    switch (activeTab) {
      case "company-info":
        return "Company Information";
      case "google-forms":
        return "Google Forms";
      case "pay-now":
        return "Pay Now Details";
      case "schedulingwindows":
        return "Scheduling Windows";
      case "followuptasks":
        return "Follow-Up Tasks";
      case "jobstatuses":
        return "Job Statuses";
      case "incentives":
        return "Job Incentives";
      case "notifications":
        return "Notifications";
      case "email":
        return "Email Settings";
      case "session-devices":
        return "Session & Devices";
      default:
        return "Settings";
    }
  };

  // Add this helper function for descriptions
  const getPageDescription = () => {
    switch (activeTab) {
      case "company-info":
        return "Manage your company's profile information, logo, and contact details.";
      case "google-forms":
        return "Configure and manage Google Forms URL links for form submissions.";
      case "pay-now":
        return "Configure PayNow and bank transfer details shown on jobsheet PDFs.";
      case "schedulingwindows":
        return "Set up and manage time slots for job scheduling.";
      case "followuptasks":
        return "Manage follow-up task types and their status workflows.";
      case "jobstatuses":
        return "Manage job statuses with custom names and colors for the Create/Edit Job form.";
      case "incentives":
        return "Configure hourly incentive rates for technicians.";
      case "notifications":
        return "Configure SMS and push notification settings.";
      case "email":
        return "Set up and manage automated email notifications.";
      case "session-devices":
        return "Reset your session to sign in on another device.";
      default:
        return "Configure your system settings.";
    }
  };

  // Add these state declarations near the top with your other states
  const [showAddWindowModal, setShowAddWindowModal] = useState(false);
  const [newWindow, setNewWindow] = useState({
    label: '',
    timeStart: '',
    timeEnd: '',
    isPublic: true
  });

  // Payment profiles state
  const [paymentProfiles, setPaymentProfiles] = useState([]);
  const [editingPaymentProfile, setEditingPaymentProfile] = useState(null);
  const [showPaymentProfileModal, setShowPaymentProfileModal] = useState(false);
  const [paymentProfileForm, setPaymentProfileForm] = useState({
    label: '',
    pay_to: '',
    bank_name: '',
    account_no: '',
    paynow_uen: '',
    paynow_uen_qr: ''
  });

  // Add these handler functions
  const handleAddWindow = () => {
    setShowAddWindowModal(true);
  };

  const handleCloseAddWindowModal = () => {
    setShowAddWindowModal(false);
    setNewWindow({
      label: '',
      timeStart: '',
      endTime: '',
      isPublic: true
    });
  };

  const handleSaveNewWindow = async () => {
    try {
      if (!newWindow.label || !newWindow.timeStart || !newWindow.timeEnd) {
        toast.error('Please fill in all required fields');
        return;
      }

      await addSchedulingWindowToFirestore(newWindow);
      await fetchSchedulingWindows();
      handleCloseAddWindowModal();
      void clientAuditLog({
        action: 'SETTINGS_UPDATE',
        category: 'settings',
        description: 'Scheduling window added',
        details: { area: 'scheduling' },
      });
      toast.success('Scheduling window added successfully');
    } catch (error) {
      console.error('Error adding scheduling window:', error);
      toast.error('Failed to add scheduling window');
    }
  };

  // Add this modal component
  const AddWindowModal = () => (
    <Modal show={showAddWindowModal} onHide={handleCloseAddWindowModal}>
      <Modal.Header closeButton>
        <Modal.Title>Add Scheduling Window</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Window Label</Form.Label>
            <Form.Control
              type="text"
              placeholder="e.g., Morning, Afternoon"
              value={newWindow.label}
              onChange={(e) => setNewWindow({ ...newWindow, label: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Start Time</Form.Label>
            <Form.Control
              type="time"
              value={newWindow.timeStart}
              onChange={(e) => setNewWindow({ ...newWindow, timeStart: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>End Time</Form.Label>
            <Form.Control
              type="time"
              value={newWindow.timeEnd}
              onChange={(e) => setNewWindow({ ...newWindow, timeEnd: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Public</Form.Label>
            <Form.Select
              value={newWindow.isPublic ? "yes" : "no"}
              onChange={(e) => setNewWindow({ ...newWindow, isPublic: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Form.Select>
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleCloseAddWindowModal}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSaveNewWindow}>
          Add Window
        </Button>
      </Modal.Footer>
    </Modal>
  );


  // Add these state declarations at the top with your other states
  const [newType, setNewType] = useState({
    name: '',
    color: '#3b82f6'
  });

  // Add these functions to handle follow-up types
  const handleAddType = async () => {
    try {
      setIsSaving(true);
      
      if (!newType.name.trim()) {
        toast.error('Please enter a type name');
        return;
      }

      const loadingToast = toast.loading('Adding type...');
      
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const updatedTypes = {
        ...(followUpSettings.types || {}),
        [Date.now()]: {
          name: newType.name.trim(),
          color: newType.color
        }
      };

      // First, verify the settings table exists by trying a simple query
      const { error: tableCheckError } = await supabase
        .from('settings')
        .select('id')
        .limit(1);
      
      if (tableCheckError) {
        // Table doesn't exist or there's a schema issue
        if (tableCheckError.code === '42P01' || tableCheckError.message.includes('does not exist')) {
          throw new Error('Settings table does not exist. Please run the migration SQL in your Supabase database. See lib/supabase/migrations/fix_settings_table_complete.sql');
        }
        throw new Error(`Database error: ${tableCheckError.message}`);
      }

      // Try to get existing settings to preserve statuses
      const { data: existingSettings, error: fetchError } = await supabase
        .from('settings')
        .select('value')
        .eq('id', 'followUp')
        .maybeSingle();

      // If there's an error fetching (but not a "not found" error), log it
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error fetching existing settings:', fetchError);
      }

      // Prepare the value object - ensure it's a plain object, not nested
      const existingValue = existingSettings?.value || {};
      const valueData = {
        types: updatedTypes,
        statuses: existingValue.statuses || followUpSettings.statuses || []
      };

      // Use upsert - Supabase will handle JSONB automatically
      const { error } = await supabase
        .from('settings')
        .upsert({
          id: 'followUp',
          value: valueData
        }, {
          onConflict: 'id'
        });

      if (error) {
        console.error('Supabase upsert error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        
        // Provide more helpful error messages
        if (error.message.includes('statuses') || error.message.includes('schema cache')) {
          throw new Error('Settings table schema issue. Please run the migration SQL in Supabase to create/update the settings table. The table needs a JSONB "value" column, not separate columns for types/statuses.');
        }
        throw error;
      }

      setFollowUpSettings(prev => ({
        ...prev,
        types: updatedTypes
      }));

      setNewType({
        name: '',
        color: '#3b82f6'
      });

      toast.dismiss(loadingToast);
      toast.success('Follow-up type added successfully');
      void invalidateSettingsCachesClient();
      void clientAuditLog({
        action: 'SETTINGS_UPDATE',
        category: 'settings',
        description: 'Follow-up type added',
        details: { area: 'follow_up_types' },
      });
    } catch (error) {
      console.error('Error adding follow-up type:', error);
      toast.error(`Failed to add follow-up type: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteType = async (typeId) => {
    try {
      const loadingToast = toast.loading('Deleting type...');
      
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('settings')
        .select('*')
        .eq('id', 'followUp')
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      if (!currentData || !currentData.value) {
        toast.dismiss(loadingToast);
        toast.error('Settings document not found');
        return;
      }

      // Create a copy of the current types from the value field
      const currentSettings = currentData.value;
      const updatedTypes = { ...(currentSettings.types || {}) };
      
      // Delete the specific type
      delete updatedTypes[typeId];

      // Update the document with the new types object
      const { error: updateError } = await supabase
        .from('settings')
        .update({
          value: {
            types: updatedTypes,
            statuses: currentSettings.statuses || []
          }
        })
        .eq('id', 'followUp');

      if (updateError) throw updateError;

      // Update local state
      setFollowUpSettings(prev => ({
        ...prev,
        types: updatedTypes
      }));

      toast.dismiss(loadingToast);
      toast.success('Type deleted successfully');
      void invalidateSettingsCachesClient();
      
    } catch (error) {
      console.error('Error deleting type:', error);
      toast.error(`Failed to delete type: ${error.message}`);
    }
  };

  useEffect(() => {
    if (bundleSettings.followUp) {
      setFollowUpSettings(bundleSettings.followUp);
    }
  }, [bundleSettings.followUp]);

  useEffect(() => {
    if (bundleSettings.jobStatuses?.types) {
      setJobStatusSettings({ types: bundleSettings.jobStatuses.types });
      return;
    }

    if (!bundleSettings.isLoading && bundleSettings.jobStatuses == null) {
      const defaults = getDefaultJobStatuses();
      const typesObj = Object.fromEntries(
        defaults.map((s) => [
          s.id,
          { name: s.name, color: s.color ?? '#3b82f6', value: s.value },
        ])
      );
      setJobStatusSettings({ types: typesObj });
    }
  }, [bundleSettings.jobStatuses, bundleSettings.isLoading]);

  // Add these state declarations at the top with your other states
  const [statusFlow, setStatusFlow] = useState({
    name: '',
    color: '#3b82f6',
    order: 0,
    isDefault: false
  });

 
  // Add these state declarations at the top with your other states
  const [newStatus, setNewStatus] = useState({
    name: '',
    description: '',
    isDefault: false
  });

  // Add this function to handle adding new statuses
  const handleAddStatus = async () => {
    try {
      setIsSaving(true);

      if (!newStatus.name.trim()) {
        toast.error('Please enter a status name');
        return;
      }

      const loadingToast = toast.loading('Adding status...');

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const currentStatuses = followUpSettings.statuses || [];
      const updatedStatuses = [...currentStatuses, {
        name: newStatus.name.trim(),
        description: newStatus.description.trim(),
        isDefault: newStatus.isDefault,
        order: currentStatuses.length
      }];

      const { error } = await supabase
        .from('settings')
        .upsert({
          id: 'followUp',
          value: {
            types: followUpSettings.types || {},
            statuses: updatedStatuses
          }
        }, {
          onConflict: 'id'
        });

      if (error) throw error;

      setFollowUpSettings(prev => ({
        ...prev,
        statuses: updatedStatuses
      }));

      setNewStatus({
        name: '',
        description: '',
        isDefault: false
      });

      toast.dismiss(loadingToast);
      toast.success('Status added successfully');
      void invalidateSettingsCachesClient();
    } catch (error) {
      console.error('Error adding status:', error);
      toast.error('Failed to add status');
    } finally {
      setIsSaving(false);
    }
  };

  // Add these state declarations at the top with your other states
  const [editingType, setEditingType] = useState(null);

  // Add these functions to handle editing follow-up types
  const handleEditType = (typeId) => {
    const typeToEdit = followUpSettings.types[typeId];
    if (typeToEdit) {
      setEditingType({
        id: typeId,
        ...typeToEdit
      });
    }
  };

  const handleUpdateType = async (typeId) => {
    try {
      const loadingToast = toast.loading('Updating type...');

      if (!editingType.name?.trim()) {
        toast.error('Please enter a type name');
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Create updated types object
      const updatedTypes = {
        ...(followUpSettings.types || {}),
        [typeId]: {
          ...(followUpSettings.types?.[typeId] || {}),
          name: editingType.name,
          color: editingType.color
        }
      };

      // Update Supabase
      const { error } = await supabase
        .from('settings')
        .upsert({
          id: 'followUp',
          value: {
            types: updatedTypes,
            statuses: followUpSettings.statuses || []
          }
        }, {
          onConflict: 'id'
        });

      if (error) throw error;

      // Update local state
      setFollowUpSettings(prev => ({
        ...prev,
        types: updatedTypes
      }));

      // Exit edit mode
      setEditingType(null);

      toast.dismiss(loadingToast);
      toast.success('Follow-up type updated successfully');
      void invalidateSettingsCachesClient();
      void clientAuditLog({
        action: 'SETTINGS_UPDATE',
        category: 'settings',
        description: 'Follow-up type updated',
        details: { area: 'follow_up_types' },
      });
    } catch (error) {
      console.error('Error updating follow-up type:', error);
      toast.error(`Failed to update type: ${error.message}`);
    }
  };

  // Job status types: add, edit, delete
  const handleAddJobStatusType = async () => {
    try {
      setIsSaving(true);
      if (!newJobStatusType.name.trim() || !newJobStatusType.value.trim()) {
        toast.error('Please enter both status name and value (e.g. CREATED)');
        return;
      }

      const loadingToast = toast.loading('Adding job status...');
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client not available');

      const typeId = String(Date.now());
      const updatedTypes = {
        ...(jobStatusSettings.types || {}),
        [typeId]: {
          name: newJobStatusType.name.trim(),
          color: newJobStatusType.color,
          value: newJobStatusType.value.trim().toUpperCase()
        }
      };

      const { error } = await supabase
        .from('settings')
        .upsert({ id: 'jobStatuses', value: { types: updatedTypes } }, { onConflict: 'id' });

      if (error) throw error;

      setJobStatusSettings((prev) => ({ ...prev, types: updatedTypes }));
      setNewJobStatusType({ name: '', color: '#3b82f6', value: '' });
      toast.dismiss(loadingToast);
      toast.success('Job status added successfully');
      void invalidateSettingsCachesClient();
      void clientAuditLog({
        action: 'SETTINGS_UPDATE',
        category: 'settings',
        description: 'Job status added',
        details: { area: 'job_statuses' },
      });
    } catch (error) {
      console.error('Error adding job status:', error);
      toast.error(`Failed to add job status: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteJobStatusType = async (typeId) => {
    try {
      const loadingToast = toast.loading('Deleting job status...');
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client not available');

      const updatedTypes = { ...(jobStatusSettings.types || {}) };
      delete updatedTypes[typeId];

      const { error } = await supabase
        .from('settings')
        .upsert({ id: 'jobStatuses', value: { types: updatedTypes } }, { onConflict: 'id' });

      if (error) throw error;

      setJobStatusSettings((prev) => ({ ...prev, types: updatedTypes }));
      toast.dismiss(loadingToast);
      toast.success('Job status deleted successfully');
      void invalidateSettingsCachesClient();
    } catch (error) {
      console.error('Error deleting job status:', error);
      toast.error(`Failed to delete job status: ${error.message}`);
    }
  };

  const handleEditJobStatusType = (typeId) => {
    const t = jobStatusSettings.types?.[typeId];
    if (t) setEditingJobStatusType({ id: typeId, ...t });
  };

  const handleUpdateJobStatusType = async (typeId) => {
    try {
      if (!editingJobStatusType?.name?.trim() || !editingJobStatusType?.value?.trim()) {
        toast.error('Please enter both status name and value');
        return;
      }

      const loadingToast = toast.loading('Updating job status...');
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client not available');

      const updatedTypes = {
        ...(jobStatusSettings.types || {}),
        [typeId]: {
          name: editingJobStatusType.name.trim(),
          color: editingJobStatusType.color,
          value: editingJobStatusType.value.trim().toUpperCase()
        }
      };

      const { error } = await supabase
        .from('settings')
        .upsert({ id: 'jobStatuses', value: { types: updatedTypes } }, { onConflict: 'id' });

      if (error) throw error;

      setJobStatusSettings((prev) => ({ ...prev, types: updatedTypes }));
      setEditingJobStatusType(null);
      toast.dismiss(loadingToast);
      toast.success('Job status updated successfully');
      void invalidateSettingsCachesClient();
      void clientAuditLog({
        action: 'SETTINGS_UPDATE',
        category: 'settings',
        description: 'Job status updated',
        details: { area: 'job_statuses' },
      });
    } catch (error) {
      console.error('Error updating job status:', error);
      toast.error(`Failed to update job status: ${error.message}`);
    }
  };

  // Add these state declarations at the top with your other states
  const [isEditing, setIsEditing] = useState(false);

  // Update the main render function
  return (
    <Container className="mt-1">
      <DashboardHeader
        title={getCurrentPageTitle()}
        subtitle={getPageDescription()}
        breadcrumbs={[
          { icon: 'fe fe-home', label: 'Dashboard', href: '/dashboard' },
          { icon: 'fe fe-settings', label: 'Settings', href: '/dashboard/settings' },
          { label: getCurrentPageTitle() }
        ]}
      />
      
      <Row>
        {/* Left Column — settings navigation */}
        <Col lg={3} className={styles.settingsSidebarSticky}>
          <nav className={styles.settingsNav} aria-label="Settings">
            {settingsCategories.map((category, idx) => (
              <div key={idx} className={styles.navSection}>
                <div className={styles.navSectionHeader}>
                  <span className={styles.navSectionHeaderIcon} aria-hidden="true">{category.icon}</span>
                  <span className={styles.navSectionTitle}>{category.title}</span>
                </div>
                <div className={styles.navSectionItems}>
                  {category.items
                    .filter((item) => !item.adminOnly || currentUser?.role === 'ADMIN')
                    .map((item) => {
                      const isActive =
                        item.action !== "company-memos" && activeTab === item.action;
                      return (
                        <button
                          key={item.action}
                          type="button"
                          disabled={!!item.disabled}
                          className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                          onClick={() => !item.disabled && handleNavigation(item.action)}
                        >
                          <span className={styles.navItemLeading}>{item.icon}</span>
                          <span className={styles.navItemText}>
                            <span className={styles.navItemTitleRow}>
                              <span className={styles.navItemTitle}>{item.name}</span>
                              {item.promoBadge ? (
                                <Badge pill bg="primary" className={styles.navItemPromoBadge}>
                                  {item.promoBadge}
                                </Badge>
                              ) : null}
                            </span>
                            <span className={styles.navItemDesc}>{item.description}</span>
                            {item.disabled && (
                              <Badge bg="secondary" className={`${styles.navItemBadge} align-self-start`}>
                                Coming Soon
                              </Badge>
                            )}
                          </span>
                          <FaChevronRight className={styles.navItemChevron} aria-hidden />
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </nav>
        </Col>

        {/* Right Content Area */}
        <Col lg={9}>
          {/* Content Area */}
          {renderContent()}
        </Col>
      </Row>
    </Container>
  );
};

export default Settings;
