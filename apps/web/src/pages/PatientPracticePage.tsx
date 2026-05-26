/** Legacy practice URL — send families to the main patient sign-in. */
import { Navigate, useParams } from 'react-router-dom';

export function PatientPracticePage() {
  const { slug } = useParams();
  return <Navigate to={`/parent/login${slug ? `?from=${slug}` : ''}`} replace />;
}
