import { Link } from 'react-router-dom'
import Section from '../components/Section'

function NotFoundPage() {
  return (
    <div className="page">
      <Section title="페이지를 찾을 수 없습니다.">
        <p className="muted">요청한 페이지가 존재하지 않습니다.</p>
        <Link to="/" className="btn">
          메인으로 돌아가기
        </Link>
      </Section>
    </div>
  )
}

export default NotFoundPage
